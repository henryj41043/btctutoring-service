import * as dynamoose from 'dynamoose';
import { BillingSchema } from '../schemas/billing.schema';

export const BillingModel = dynamoose.model(
  'BTCTutoring-Billing-Table',
  BillingSchema,
);
