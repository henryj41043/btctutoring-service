import * as dynamoose from 'dynamoose';
import { ScholarshipsSchema } from '../schemas/scholarships.schema';
import { TABLE_OPTIONS } from './table-options';

export const ScholarshipsModel = dynamoose.model(
  'BTCTutoring-Scholarships-Table',
  ScholarshipsSchema,
  TABLE_OPTIONS,
);
