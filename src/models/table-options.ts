import { ModelTableOptions } from 'dynamoose/dist/Model';

/**
 * Shared dynamoose table options for every model. The defaults
 * (create/waitForActive) issue a DescribeTable per table at startup and gate
 * the first operation on it — all tables are provisioned by CDK, so the checks
 * only add cold-start latency (and the task role has no CreateTable anyway).
 */
export const TABLE_OPTIONS: ModelTableOptions = {
  create: false,
  update: false,
  waitForActive: false,
};
