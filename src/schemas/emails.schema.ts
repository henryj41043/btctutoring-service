import * as dynamoose from 'dynamoose';

export const EmailsSchema = new dynamoose.Schema({
  // Content hash of the original email — dedup by construction.
  id: {
    type: String,
    hashKey: true,
  },
  status: {
    type: String,
    enum: ['matched', 'unmatched', 'discarded'],
  },
  contact_id: String,
  from_email: String,
  from_name: String,
  subject: String,
  sent_at: String,
  received_at: String,
  body_text: String,
  s3_key: String,
  forwarded_by: String,
  match_method: {
    type: String,
    enum: ['rfc822', 'inline', 'none'],
  },
  assigned_by: String,
  assigned_at: String,
  created_at: String,
});
