import * as dynamoose from 'dynamoose';

export const ScholarshipsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  contact_id: String,
  // 'YYYY-MM' — the record's calendar month (the id's second half).
  month: String,
  scholarship_state: String,
  // The client's free-text invoice-month label, kept verbatim.
  invoice_Month: String,
  date_funds_requested_by_btc: Date,
  date_funds_requested_by_family: Date,
  invoice_number: String,
  invoice_paid_date: Date,
});
