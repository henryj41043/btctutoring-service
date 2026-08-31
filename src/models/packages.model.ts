import * as dynamoose from 'dynamoose';
import { PackagesSchema } from '../schemas/packages.schema';
import { TABLE_OPTIONS } from './table-options';

export const PackagesModel = dynamoose.model(
  'BTCTutoring-Packages-Table',
  PackagesSchema,
  TABLE_OPTIONS,
);
