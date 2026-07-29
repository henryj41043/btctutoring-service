import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { SessionsSchema } from '../schemas/sessions.schema';

export const SessionsModel = dynamoose.model(
  'BTCTutoring-Sessions-Table',
  SessionsSchema,
  TABLE_OPTIONS,
);
