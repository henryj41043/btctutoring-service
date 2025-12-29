import * as dynamoose from 'dynamoose';

export const SessionsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  end_datetime: String,
  notes: String,
  start_datetime: String,
  status: String,
  student_id: String,
  student_name: String,
  tutor_id: String,
  tutor_name: String,
});
