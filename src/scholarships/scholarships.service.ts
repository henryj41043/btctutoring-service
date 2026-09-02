import { Injectable, Logger } from '@nestjs/common';
import { ScholarshipsModel } from '../models/scholarships.model';
import { ScholarshipRecord } from '../models/scholarship-record.model';

@Injectable()
export class ScholarshipsService {
  /** Deterministic record id: one record per contact per month. */
  static recordId(contactId: string, month: string): string {
    return `${contactId}#${month}`;
  }

  async getScholarshipRecords() {
    return ScholarshipsModel.scan()
      .all()
      .exec()
      .then((records) => {
        return records;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getScholarshipRecordsByContact(contactId: string) {
    return ScholarshipsModel.scan({
      contact_id: { eq: contactId },
    })
      .all()
      .exec()
      .then((records) => {
        return records;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getScholarshipRecordsByMonth(month: string) {
    return ScholarshipsModel.scan({
      month: { eq: month },
    })
      .all()
      .exec()
      .then((records) => {
        return records;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Creates or fully replaces the record for (contact, month). The caller
   * supplies the full intended state; the deterministic id makes the write
   * idempotent.
   */
  async upsertScholarshipRecord(record: ScholarshipRecord) {
    const id = ScholarshipsService.recordId(record.contact_id, record.month);
    const attributes: Record<string, unknown> = {
      id,
      contact_id: record.contact_id,
      month: record.month,
      scholarship_state: record.scholarship_state,
      invoice_Month: record.invoice_Month,
      date_funds_requested_by_btc: record.date_funds_requested_by_btc,
      date_funds_requested_by_family: record.date_funds_requested_by_family,
      invoice_number: record.invoice_number,
      invoice_paid_date: record.invoice_paid_date,
    };
    // The form sends null for empty optional fields, and dynamoose rejects
    // null for typed (notably Date) attributes ("Expected ... to be of type
    // date, instead found type null"). save() is a full replace, so stripped
    // keys simply drop from the stored record — exactly what clearing means.
    for (const key of Object.keys(attributes)) {
      if (attributes[key] === null || attributes[key] === undefined) {
        delete attributes[key];
      }
    }
    const item = new ScholarshipsModel(attributes);
    return item
      .save()
      .then(() => {
        return { id, message: 'Scholarship record saved.' };
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
