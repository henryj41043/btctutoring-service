import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { ContactsSchema } from '../schemas/contacts.schema';

export const ContactsModel = dynamoose.model(
  'BTCTutoring-Contacts-Table',
  ContactsSchema,
  TABLE_OPTIONS,
);
