import * as dynamoose from 'dynamoose';
import { NotesSchema } from '../schemas/notes.schema';

export const NotesModel = dynamoose.model(
  'BTCTutoring-Notes-Table',
  NotesSchema,
);
