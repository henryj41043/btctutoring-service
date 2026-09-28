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
    return rows
      .filter((row) => row.status === 'ready')
      .sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''));
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
      { status: 'ready' },
    )) as unknown as ContactDocument;
  }

  /** A short-lived link that shows the file in the browser or downloads it. */
  async getDocumentUrl(
    id: string,
    mode: DocumentUrlMode,
  ): Promise<{ url: string }> {
    const bucket = this.bucket();
    const row = await this.requireDocument(id);
    if (row.status !== 'ready' || !row.s3_key) {
      throw new NotFoundException('Document not found');
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
