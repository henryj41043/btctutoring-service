import * as dynamoose from 'dynamoose';

export const BillingSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  contact_id: String,
  period_start: String,
  cycle: String,
  amount: Number,
  paid: Boolean,
  paid_date: String,
  invoice_number: String,
  // Admin per-period override of the derived amount (0 = "No charge");
  // absent = bill the derived amount.
  amount_override: Number,
  // Billing v2 frozen statements live in this table too, keyed
  // `stmt#<contactId>#<YYYY-MM>`. They carry NO period_start, so the
  // per-date record queries never see them.
  statement_month: String,
  frozen_at: String,
  legacy: Boolean,
  // The whole statement as JSON: it is written once and read whole.
  statement: String,
});
