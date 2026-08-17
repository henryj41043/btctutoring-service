import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { EmailsSchema } from '../schemas/emails.schema';

export const EmailsModel = dynamoose.model(
  'BTCTutoring-Emails-Table',
  EmailsSchema,
  TABLE_OPTIONS,
);
