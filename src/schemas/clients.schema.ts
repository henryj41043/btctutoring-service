import * as dynamoose from 'dynamoose';

export const ClientsSchema = new dynamoose.Schema({
  email: {
    type: String,
    hashKey: true,
  },
  assigned_tutor: String,
  billing_cycle: String,
  btc_and_me_enrolled: Boolean,
  completed_sessions: Number,
  inquiry_date: String,
  interview_scheduled: Boolean,
  makeup_sessions: Number,
  notes: String,
  package: String,
  parent_name: String,
  phone_number: String,
  registration_received: Boolean,
  scholarship: Boolean,
  scholarship_name: String,
  service: String,
  sessions: Number,
  status: String,
  student_birthday: String,
  student_name: String,
});
