import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { NotesSchema } from '../schemas/notes.schema';

export const NotesModel = dynamoose.model(
  'BTCTutoring-Notes-Table',
  NotesSchema,
  TABLE_OPTIONS,
);
