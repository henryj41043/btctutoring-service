import * as dynamoose from 'dynamoose';

export const EmployeesSchema = new dynamoose.Schema({
  email: {
    type: String,
    hashKey: true,
  },
  first_name: String,
  last_name: String,
  phone_number: String,
  group: String,
  status: String,
  service: String,
  notes: String,
  interview_scheduled: Boolean,
});
