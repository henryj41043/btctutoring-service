import * as dynamoose from 'dynamoose';
import { ContactsSchema } from '../schemas/contacts.schema';

export const ContactsModel = dynamoose.model(
  'BTCTutoring-Contacts-Table',
  ContactsSchema,
);
