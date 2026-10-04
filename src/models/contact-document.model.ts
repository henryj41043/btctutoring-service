import { ScanStatus } from '../documents/scan-status';

/**
 * One file an admin uploaded to a contact (a resume, a signed form).
 *
 * The file itself lives in the private documents bucket under `s3_key`; the
 * browser sends and fetches it with short-lived presigned links, so it never
 * passes through this service.
 */
export class ContactDocument {
  id?: string;
  contact_id?: string;
  /** The name the admin's file had, cleaned; never part of the storage key. */
  file_name?: string;
  content_type?: string;
  /** Bytes. */
  size?: number;
  s3_key?: string;
  /** pending until the upload is confirmed against what storage received. */
  status?: 'pending' | 'ready';
  /**
   * The malware scan's verdict; only a clean document can be opened. Absent
   * on documents stored before scanning existed, which stay openable.
   */
  scan_status?: ScanStatus;
  uploaded_by?: string;
  uploaded_at?: string;
}
