import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BillingModel } from '../models/billing.model';
import {
  AmountOverrideRequest,
  BillingRecord,
} from '../models/billing-record.model';

@Injectable()
export class BillingService {
  /** Deterministic id so a contact's period record is idempotently upsertable. */
  static recordId(contactId: string, periodStart: string): string {
    return `${contactId}#${periodStart}`;
  }

  async getBillingRecords() {
    return BillingModel.scan()
      .all()
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getBillingRecordsByContact(contactId: string) {
    return BillingModel.scan({ contact_id: { eq: contactId } })
      .all()
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getBillingRecordsByPeriod(periodStart: string) {
    return BillingModel.scan({ period_start: { eq: periodStart } })
      .all()
      .exec()
      .then((records) => records)
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** All of a month's records (both the 1st and 15th periods) in one call. */
  async getBillingRecordsByMonth(month: string) {
    return BillingModel.scan()
      .where('period_start')
      .beginsWith(month)
      .all()
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
    const attributes: Record<string, unknown> = {
      id,
      contact_id: record.contact_id,
      period_start: record.period_start,
      cycle: record.cycle,
      amount: record.amount,
      paid: record.paid,
      paid_date: record.paid_date,
      invoice_number: record.invoice_number,
      // A PutItem replaces the whole item, so callers must carry the
      // override they loaded (the Billing page does); a missing/null value
      // is stripped rather than written as null (dynamoose rejects null).
      amount_override: record.amount_override,
    };
    for (const key of Object.keys(attributes)) {
      if (attributes[key] === undefined || attributes[key] === null) {
        delete attributes[key];
      }
    }
    const model = new BillingModel(attributes);
    return model
      .save()
      .then(() => Promise.resolve({ id, message: 'Billing record saved.' }))
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Sets or clears an admin's per-period amount override (client request
   * 2026-09: "No charge" = 0, or a custom amount). Touches ONLY the override
   * on an existing record — paid state, paid date and the derived snapshot
   * stay as they are — and creates a minimal unpaid record when none exists
   * yet (an override may be set before any paid toggle or cron run). Clearing
   * a never-recorded period is a no-op.
   */
  async setAmountOverride(
    request: AmountOverrideRequest,
  ): Promise<{ id: string; message: string }> {
    const override = request.amount_override;
    if (
      override !== null &&
      (typeof override !== 'number' ||
        !Number.isFinite(override) ||
        override < 0)
    ) {
      throw new BadRequestException(
        'amount_override must be a non-negative number, or null to clear.',
      );
    }
    if (!request.contact_id || !request.period_start) {
      throw new BadRequestException(
        'contact_id and period_start are required.',
      );
    }
    const id = BillingService.recordId(
      request.contact_id,
      request.period_start,
    );
    const existing = (await BillingModel.get(id).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    })) as unknown as BillingRecord | undefined;

    if (!existing) {
      if (override === null) {
        return { id, message: 'No billing record to clear.' };
      }
      await BillingModel.create({
        id,
        contact_id: request.contact_id,
        period_start: request.period_start,
        cycle: request.cycle,
        amount: override,
        paid: false,
        amount_override: override,
      }).catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
      return { id, message: 'Billing override saved.' };
    }

    const update =
      override === null
        ? { $REMOVE: ['amount_override'] }
        : { $SET: { amount_override: override } };
    await BillingModel.update({ id }, update).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    });
    return {
      id,
      message:
        override === null
          ? 'Billing override cleared.'
          : 'Billing override saved.',
    };
  }
}
