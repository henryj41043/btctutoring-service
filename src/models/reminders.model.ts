import * as dynamoose from 'dynamoose';
import { RemindersSchema } from '../schemas/reminders.schema';

export const RemindersModel = dynamoose.model(
  'BTCTutoring-Reminders-Table',
  RemindersSchema,
);
