import * as dynamoose from 'dynamoose';
import { SessionsSchema } from '../schemas/sessions.schema';

export const SessionsModel = dynamoose.model(
  'BTCTutoring-Sessions-Table',
  SessionsSchema,
);
