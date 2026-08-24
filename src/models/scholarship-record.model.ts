/**
 * One contact's scholarship checklist for one calendar month. Replaces the
 * old single-valued scholarship fields on the contact (which lost history on
 * every month-end clear).
 *
 * `id` is deterministic — `${contact_id}#${month}` — so a month's record is
 * idempotently upsertable without a secondary index.
 */
export class ScholarshipRecord {
  id?: string;
  contact_id: string;
  month: string; // 'YYYY-MM'
  scholarship_state?: string;
  /** The client's free-text invoice-month label, kept verbatim. */
  invoice_Month?: string;
  date_funds_requested_by_btc?: Date;
  date_funds_requested_by_family?: Date;
  invoice_number?: string;
  invoice_paid_date?: Date;
}
