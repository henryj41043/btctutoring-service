import { Injectable, Logger } from '@nestjs/common';
import { BillingModel } from '../models/billing.model';
import { BillingRecord } from '../models/billing-record.model';

@Injectable()
export class BillingService {
  /** Deterministic id so a contact's period record is idempotently upsertable. */
  static recordId(contactId: string, periodStart: string): string {
    return `${contactId}#${periodStart}`;
  }

  async getBillingRecords() {
    return BillingModel.scan()
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getBillingRecordsByContact(contactId: string) {
    return BillingModel.scan({ contact_id: { eq: contactId } })
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getBillingRecordsByPeriod(periodStart: string) {
    return BillingModel.scan({ period_start: { eq: periodStart } })
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** True if a dynamoose error is the conditional "item already exists" failure. */
  private static isAlreadyExists(error: unknown): boolean {
    const e = error as { name?: string; message?: string };
    const name: string = e?.name ?? '';
    const message: string = e?.message ?? '';
    return (
      name === 'ConditionalCheckFailedException' ||
      /already exists|ConditionalCheckFailed/i.test(message)
    );
  }

  /**
   * Creates a billing record only if one doesn't already exist for the period
   * (a conditional create on the deterministic id). Used by auto-renew so it
   * never clobbers a record an admin has already marked paid. Returns whether a
   * new record was written.
   */
  async createBillingRecordIfAbsent(
    record: BillingRecord,
  ): Promise<{ id: string; created: boolean }> {
    const id = BillingService.recordId(record.contact_id, record.period_start);
    return BillingModel.create({
      id,
      contact_id: record.contact_id,
      period_start: record.period_start,
      cycle: record.cycle,
      amount: record.amount,
      paid: record.paid,
    })
      .then(() => ({ id, created: true }))
      .catch((error: Error) => {
        if (BillingService.isAlreadyExists(error)) {
          return { id, created: false };
        }
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Acquires a once-per-key lock via a conditional create on a sentinel item, so
   * a scheduled job runs at most once even across multiple ECS tasks. Returns
   * true if this caller won the lock. The sentinel uses contact_id 'lock' so the
   * Billing page (which joins records to real contacts) ignores it.
   */
  async acquireLock(lockId: string): Promise<boolean> {
    return BillingModel.create({
      id: lockId,
      contact_id: 'lock',
      period_start: lockId,
      cycle: 'lock',
      amount: 0,
      paid: true,
    })
      .then(() => true)
      .catch((error: Error) => {
        if (BillingService.isAlreadyExists(error)) {
          return false;
        }
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Creates or overwrites a contact's billing record for a period. The full
   * intended state (amount + paid status) is supplied by the caller; the
   * deterministic id makes this a safe PutItem upsert.
   */
  async upsertBillingRecord(record: BillingRecord) {
    const id = BillingService.recordId(record.contact_id, record.period_start);
    const model = new BillingModel({
      id,
      contact_id: record.contact_id,
      period_start: record.period_start,
      cycle: record.cycle,
      amount: record.amount,
      paid: record.paid,
      paid_date: record.paid_date,
      invoice_number: record.invoice_number,
    });
    return model
      .save()
      .then(() => Promise.resolve({ id, message: 'Billing record saved.' }))
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
