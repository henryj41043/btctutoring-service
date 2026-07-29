import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { RemindersSchema } from '../schemas/reminders.schema';

export const RemindersModel = dynamoose.model(
  'BTCTutoring-Reminders-Table',
  RemindersSchema,
  TABLE_OPTIONS,
);
