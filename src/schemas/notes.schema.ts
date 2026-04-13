import * as dynamoose from 'dynamoose';

export const NotesSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  message: String,
  date_time: String,
  author: String,
  author_id: String,
  recipient: String,
  recipient_id: String,
  type: String,
});
