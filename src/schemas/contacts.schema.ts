import * as dynamoose from 'dynamoose';

export const ContactsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  first_name: String,
  last_name: String,
  email: String,
  phone_number: String,
  service: String,
});
