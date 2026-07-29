import * as dynamoose from 'dynamoose';
import { TABLE_OPTIONS } from './table-options';
import { BillingSchema } from '../schemas/billing.schema';

export const BillingModel = dynamoose.model(
  'BTCTutoring-Billing-Table',
  BillingSchema,
  TABLE_OPTIONS,
);
