import * as dynamoose from 'dynamoose';
import { StudentsSchema } from '../schemas/students.schema';

export const StudentsModel = dynamoose.model(
  'BTCTutoring-Students-Table',
  StudentsSchema,
);
