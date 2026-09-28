import * as dynamoose from 'dynamoose';

export const DocumentsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  contact_id: String,
  file_name: String,
  content_type: String,
  size: Number,
  s3_key: String,
  // pending = an upload link was issued; ready = the file arrived and was checked.
  status: {
    type: String,
    enum: ['pending', 'ready'],
  },
  uploaded_by: String,
  uploaded_at: String,
});
