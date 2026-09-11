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
});
