import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { DocumentsModel } from '../models/documents.model';
import { ContactsModel } from '../models/contacts.model';
import { ContactDocument } from '../models/contact-document.model';
import { UploadRequestDto } from './dto/upload-request.dto';
import {
  contentDisposition,
  DocumentUrlMode,
  validateUpload,
} from './document-rules';
import {
  SCAN_TAG,
  scanBlockMessage,
  scanStatusOfTag,
  scanTimedOut,
} from './scan-status';

/** Presigned links live five minutes: long enough to use, short to leak. */
export const LINK_SECONDS = 300;
/** An upload link that was never used is forgotten after a day. */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const KEY_PREFIX = 'documents/';

export interface UploadLink {
  id: string;
  url: string;
  /** Headers the browser must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
}

@Injectable()
export class DocumentsService {
  private readonly s3 = new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    // A presigned PUT is sent by a browser, which cannot add the SDK's
    // optional checksum headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  /** Fails closed: a config gap reads as a 500, never as a broken link. */
  private bucket(): string {
    const bucket = process.env.DOCUMENTS_BUCKET;
    if (!bucket) {
      Logger.error('DOCUMENTS_BUCKET is not set — documents are unavailable.');
      throw new InternalServerErrorException(
        'Document storage is not configured',
      );
    }
    return bucket;
  }

  private async rowsOf(contactId: string): Promise<ContactDocument[]> {
    return (await DocumentsModel.scan({ contact_id: { eq: contactId } })
      .all()
      .exec()) as unknown as ContactDocument[];
  }

  private async requireDocument(id: string): Promise<ContactDocument> {
    const row = (await DocumentsModel.get({ id })) as unknown as
      | ContactDocument
      | undefined;
    if (!row) {
      throw new NotFoundException('Document not found');
    }
    return row;
  }

  /** Removes the stored file (when there is one), then the row. */
  private async remove(bucket: string, row: ContactDocument): Promise<void> {
    if (row.s3_key) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: row.s3_key }),
      );
    }
    await DocumentsModel.delete({ id: row.id as string });
  }

  /**
   * Brings a document's scan status up to date from the scanner's tag. A
   * clean or unscannable verdict is recorded; an infected file is removed
   * from storage and its row kept, marked, so the admin sees what happened.
   * A failed read changes nothing: the document simply stays unopenable.
   */
  private async resolveScan(
    bucket: string,
    row: ContactDocument,
    now: Date,
  ): Promise<ContactDocument> {
    if (row.scan_status !== 'scanning') {
      return row;
    }
    let tag: string | undefined;
    try {
      const tags = await this.s3.send(
        new GetObjectTaggingCommand({ Bucket: bucket, Key: row.s3_key }),
      );
      tag = (tags.TagSet ?? []).find((item) => item.Key === SCAN_TAG)?.Value;
    } catch (error) {
      Logger.error(`Scan result of ${row.id} not read`, error as Error);
      return row;
    }
    const status = scanStatusOfTag(tag);
    if (status === 'scanning') {
      // Not recorded, so a late verdict is still picked up.
      return scanTimedOut(row.uploaded_at, now)
        ? { ...row, scan_status: 'unscanned' }
        : row;
    }
    if (status === 'infected') {
      Logger.warn(`Document ${row.id} was blocked by the malware scan`);
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: row.s3_key }),
      );
    }
    await DocumentsModel.update({ id: row.id }, { scan_status: status });
    return { ...row, scan_status: status };
  }

  /**
   * A contact's documents, newest first. Upload links that were never used
   * are cleared on the way; a failure there never fails the list.
   */
  async getDocumentsByContact(
    contactId: string,
    now: Date = new Date(),
  ): Promise<ContactDocument[]> {
    const rows = await this.rowsOf(contactId);
    const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS).toISOString();
    const stale = rows.filter(
      (row) => row.status !== 'ready' && (row.uploaded_at ?? '') < cutoff,
    );
    if (stale.length > 0) {
      const bucket = this.bucket();
      await Promise.all(
        stale.map((row) =>
          this.remove(bucket, row).catch((error: Error) =>
            Logger.error(`Stale upload ${row.id} not cleared`, error),
          ),
        ),
      );
    }
    const ready = rows.filter((row) => row.status === 'ready');
    const resolved = ready.some((row) => row.scan_status === 'scanning')
      ? await Promise.all(
          ready.map((row) => this.resolveScan(this.bucket(), row, now)),
        )
      : ready;
    return resolved.sort((a, b) =>
      (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''),
    );
  }

  /** Step 1 of an upload: checks the request and signs a link for that exact file. */
  async createUploadLink(
    contactId: string,
    request: UploadRequestDto,
    username: string,
    now: Date = new Date(),
  ): Promise<UploadLink> {
    const bucket = this.bucket();
    const check = validateUpload(request);
    if (check.error) {
      throw new BadRequestException(check.error);
    }
    const contact = (await ContactsModel.get(contactId)) as unknown;
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    const id = randomUUID();
    const key = `${KEY_PREFIX}${contactId}/${id}`;
    const row: ContactDocument = {
      id,
      contact_id: contactId,
      file_name: check.file_name,
      content_type: check.content_type,
      size: request.size,
      s3_key: key,
      status: 'pending',
      uploaded_by: username,
      uploaded_at: now.toISOString(),
    };
    // dynamoose rejects null/undefined on typed fields.
    const attrs = Object.fromEntries(
      Object.entries(row).filter(([, value]) => value != null),
    );
    await new DocumentsModel(attrs).save();
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: check.content_type,
        ContentLength: request.size,
      }),
      {
        expiresIn: LINK_SECONDS,
        // Signed, so storage refuses any other type or size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { id, url, headers: { 'Content-Type': check.content_type } };
  }

  /** Step 2: what storage received must be what was announced. */
  async completeUpload(id: string): Promise<ContactDocument> {
    const bucket = this.bucket();
    const row = await this.requireDocument(id);
    if (row.status === 'ready') {
      return row;
    }
    let stored: { ContentLength?: number; ContentType?: string };
    try {
      stored = await this.s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: row.s3_key }),
      );
    } catch (error) {
      Logger.error(`Upload ${id} not found in storage`, error as Error);
      throw new BadRequestException('The file was not received.');
    }
    if (
      stored.ContentLength !== row.size ||
      stored.ContentType !== row.content_type
    ) {
      await this.remove(bucket, row);
      throw new BadRequestException(
        'The file received does not match the upload request.',
      );
    }
    return (await DocumentsModel.update(
      { id },
      // The scan starts when the file lands and takes a few seconds.
      { status: 'ready', scan_status: 'scanning' },
    )) as unknown as ContactDocument;
  }

  /** A short-lived link to a file that passed the malware scan. */
  async getDocumentUrl(
    id: string,
    mode: DocumentUrlMode,
    now: Date = new Date(),
  ): Promise<{ url: string }> {
    const bucket = this.bucket();
    const stored = await this.requireDocument(id);
    if (stored.status !== 'ready' || !stored.s3_key) {
      throw new NotFoundException('Document not found');
    }
    const row = await this.resolveScan(bucket, stored, now);
    const blocked = scanBlockMessage(row.scan_status);
    if (blocked) {
      throw new BadRequestException(blocked);
    }
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: row.s3_key,
        ResponseContentType: row.content_type,
        ResponseContentDisposition: contentDisposition(
          row.file_name ?? 'document',
          mode,
          row.content_type,
        ),
      }),
      { expiresIn: LINK_SECONDS },
    );
    return { url };
  }

  async deleteDocument(id: string): Promise<{ id: string; message: string }> {
    const bucket = this.bucket();
    const row = await this.requireDocument(id);
    await this.remove(bucket, row);
    return { id, message: 'Document deleted successfully.' };
  }

  /** Every document of a contact (used when the contact itself is deleted). */
  async deleteDocumentsByContact(
    contactId: string,
  ): Promise<{ deleted: number }> {
    const rows = await this.rowsOf(contactId);
    if (rows.length === 0) {
      return { deleted: 0 };
    }
    const bucket = this.bucket();
    for (const row of rows) {
      await this.remove(bucket, row);
    }
    return { deleted: rows.length };
  }
}
