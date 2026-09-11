/**
 * A persisted billing payment record for one contact and one billing period.
 * Amounts are computed live on the Billing page (derived from package + schedule
 * + proration); this record persists the snapshotted amount and payment status.
 *
 * `id` is deterministic — `${contact_id}#${period_start}` — so a period's record
 * is idempotently upsertable without a secondary index.
 */
export class BillingRecord {
  id?: string;
  contact_id: string;
  period_start: string; // 'YYYY-MM-DD' (e.g. 2026-07-01 or 2026-07-15)
  cycle: string; // 'monthly' | 'semi_monthly'
  amount: number;
  paid: boolean;
  paid_date?: string;
  invoice_number?: string;
  /** Admin override of the derived amount for this period (0 = no charge); absent = derived. */
  amount_override?: number;
}

/** PUT /billing/override payload: null clears the override. */
export class AmountOverrideRequest {
  contact_id: string;
  period_start: string;
  cycle: string;
  amount_override: number | null;
}
