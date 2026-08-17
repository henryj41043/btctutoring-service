import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { EmailsModel } from '../models/emails.model';
import { EmailEntry } from '../models/email-entry.model';

@Injectable()
export class EmailsService {
  private readonly s3 = new S3Client({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

  /** A contact's filed emails, newest original first. */
  async getEmailsByContact(contactId: string) {
    return EmailsModel.scan({
      contact_id: { eq: contactId },
      status: { eq: 'matched' },
    })
      .all()
      .exec()
      .then((entries) =>
        this.sortNewestFirst(entries as unknown as EmailEntry[]),
      )
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** The review queue: everything the parser couldn't (safely) file. */
  async getUnmatchedEmails() {
    return EmailsModel.scan({ status: { eq: 'unmatched' } })
      .all()
      .exec()
      .then((entries) =>
        this.sortNewestFirst(entries as unknown as EmailEntry[]),
      )
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** Files a queued email onto a contact, stamping who resolved it. */
  async assignEmail(id: string, contactId: string, assignedBy: string) {
    await this.requireEntry(id);
    return EmailsModel.update(
      { id },
      {
        contact_id: contactId,
        status: 'matched',
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
      },
    ).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    });
  }

  /**
   * Removes a queued email from review WITHOUT deleting the row — the
   * content-hash id stays resident, so re-forwarding the same email stays
   * discarded instead of resurfacing in the queue.
   */
  async discardEmail(id: string) {
    await this.requireEntry(id);
    return EmailsModel.update({ id }, { status: 'discarded' }).catch(
      (error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      },
    );
  }

  /** Short-lived presigned link to the raw original in the inbound bucket. */
  async getOriginalUrl(id: string): Promise<{ url: string }> {
    // Fail closed BEFORE presigning — a config gap reads as a 500, not a
    // broken link handed to the admin.
    const bucket = process.env.EMAIL_BUCKET;
    if (!bucket) {
      Logger.error('EMAIL_BUCKET is not set — cannot presign originals.');
      throw new InternalServerErrorException('Email storage is not configured');
    }
    const entry = await this.requireEntry(id);
    if (!entry.s3_key) {
      throw new NotFoundException('No original stored for this email');
    }
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: bucket, Key: entry.s3_key }),
      { expiresIn: 300 },
    );
    return { url };
  }

  /** Loads an entry or 404s — shared by every per-id mutation/read. */
  private async requireEntry(id: string): Promise<EmailEntry> {
    const stored = (await EmailsModel.get({ id }).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    })) as unknown as EmailEntry | undefined;
    if (!stored) {
      throw new NotFoundException('Email entry not found');
    }
    return stored;
  }

  /** Newest first by when the parent sent it (fallback: pipeline receipt). */
  private sortNewestFirst(entries: EmailEntry[]): EmailEntry[] {
    return [...entries].sort((a, b) =>
      (b.sent_at ?? b.received_at ?? '').localeCompare(
        a.sent_at ?? a.received_at ?? '',
      ),
    );
  }
}
