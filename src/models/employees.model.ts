import * as dynamoose from 'dynamoose';
import { EmployeesSchema } from '../schemas/employees.schema';

export const EmployeesModel = dynamoose.model(
  'BTCTutoring-Employees-Table',
  EmployeesSchema,
);
