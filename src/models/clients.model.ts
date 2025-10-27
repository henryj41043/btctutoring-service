import * as dynamoose from 'dynamoose';
import { ClientsSchema } from '../schemas/clients.schema';

export const ClientsModel = dynamoose.model(
  'BTCTutoring-Clients-Table',
  ClientsSchema,
);
