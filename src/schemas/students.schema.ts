import * as dynamoose from 'dynamoose';

export const StudentsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  contact_id: String,
  name: String,
  birthday: String,
  status: String,
  assigned_tutor_id: String,
  package: String,
  available_minutes: Number,
  make_up_minutes: Number,
});
