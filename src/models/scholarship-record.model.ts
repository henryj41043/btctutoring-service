import { IsDate, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

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
  // Dates arrive over HTTP as ISO strings; without @Type they stay strings
  // and dynamoose rejects them for its Date attributes (every save of a
  // month carrying a date failed — client report 2026-09-27).
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date_funds_requested_by_btc?: Date;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date_funds_requested_by_family?: Date;
  invoice_number?: string;
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  invoice_paid_date?: Date;
}
