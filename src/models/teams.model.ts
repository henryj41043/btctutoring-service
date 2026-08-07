import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { TeamsSchema } from '../schemas/teams.schema';

export const TeamsModel = dynamoose.model(
  'BTCTutoring-Teams-Table',
  TeamsSchema,
  TABLE_OPTIONS,
);
