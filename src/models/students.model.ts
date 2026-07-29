import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { StudentsSchema } from '../schemas/students.schema';

export const StudentsModel = dynamoose.model(
  'BTCTutoring-Students-Table',
  StudentsSchema,
  TABLE_OPTIONS,
);
