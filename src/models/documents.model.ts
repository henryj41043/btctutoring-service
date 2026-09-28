import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { DocumentsSchema } from '../schemas/documents.schema';

export const DocumentsModel = dynamoose.model(
  'BTCTutoring-Documents-Table',
  DocumentsSchema,
  TABLE_OPTIONS,
);
