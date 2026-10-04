import { Test, TestingModule } from '@nestjs/testing';
import { ScholarshipsService } from './scholarships.service';
import { ScholarshipsModel } from '../models/scholarships.model';
import { ScholarshipRecord } from '../models/scholarship-record.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/scholarships.model', () => ({
  ScholarshipsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = ScholarshipsModel as unknown as ModelMock;

const sampleRecord = (
  overrides: Partial<ScholarshipRecord> = {},
): ScholarshipRecord =>
  ({
    contact_id: 'contact-1',
    month: '2026-08',
    scholarship_state: 'PA',
    invoice_Month: 'August',
    invoice_number: 'INV-12',
    ...overrides,
  }) as ScholarshipRecord;

describe('ScholarshipsService', () => {
  let service: ScholarshipsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ScholarshipsService],
    }).compile();
    service = module.get<ScholarshipsService>(ScholarshipsService);
  });

  it('builds a deterministic record id from contact + month', () => {
    expect(ScholarshipsService.recordId('contact-1', '2026-08')).toBe(
      'contact-1#2026-08',
    );
  });

  describe('read queries', () => {
    it('getScholarshipRecords scans everything', async () => {
      scanResolves(Model, [sampleRecord()]);
      const result = await service.getScholarshipRecords();
      expect(result).toHaveLength(1);
    });

    it('getScholarshipRecordsByContact scans by contact_id', async () => {
      scanResolves(Model, []);
      await service.getScholarshipRecordsByContact('contact-1');
      expect(Model.scan).toHaveBeenCalledWith({
        contact_id: { eq: 'contact-1' },
      });
    });

    it('getScholarshipRecordsByMonth exact-matches the month', async () => {
      scanResolves(Model, []);
      await service.getScholarshipRecordsByMonth('2026-08');
      expect(Model.scan).toHaveBeenCalledWith({ month: { eq: '2026-08' } });
    });

    it('propagates scan failures', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getScholarshipRecords()).rejects.toThrow(
        'scan boom',
      );
      scanRejects(Model, new Error('contact boom'));
      await expect(
        service.getScholarshipRecordsByContact('contact-1'),
      ).rejects.toThrow('contact boom');
      scanRejects(Model, new Error('month boom'));
      await expect(
        service.getScholarshipRecordsByMonth('2026-08'),
      ).rejects.toThrow('month boom');
    });
  });

  describe('deleteScholarshipRecordsByContact', () => {
    it("deletes every month's record of the contact", async () => {
      scanResolves(Model, [{ id: 'c-1#2026-08' }, { id: 'c-1#2026-09' }]);
      Model.delete.mockResolvedValue({});
      await expect(
        service.deleteScholarshipRecordsByContact('c-1'),
      ).resolves.toEqual({ deleted: 2 });
      expect(Model.scan).toHaveBeenCalledWith({ contact_id: { eq: 'c-1' } });
      expect(Model.delete.mock.calls).toEqual([
        [{ id: 'c-1#2026-08' }],
        [{ id: 'c-1#2026-09' }],
      ]);
    });

    it('reports zero for a contact without records', async () => {
      scanResolves(Model, []);
      await expect(
        service.deleteScholarshipRecordsByContact('c-1'),
      ).resolves.toEqual({ deleted: 0 });
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('rejects when the records cannot be read or deleted', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(
        service.deleteScholarshipRecordsByContact('c-1'),
      ).rejects.toThrow('scan boom');
      scanResolves(Model, [{ id: 'a' }, { id: 'b' }]);
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(
        service.deleteScholarshipRecordsByContact('c-1'),
      ).rejects.toThrow('delete boom');
      expect(Model.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertScholarshipRecord', () => {
    it('saves under the computed id with the full field set', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.upsertScholarshipRecord(
        sampleRecord({ invoice_paid_date: new Date('2026-08-20') }),
      );
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'contact-1#2026-08',
          contact_id: 'contact-1',
          month: '2026-08',
          scholarship_state: 'PA',
          invoice_Month: 'August',
          invoice_number: 'INV-12',
          invoice_paid_date: new Date('2026-08-20'),
        }),
      );
      expect(result).toEqual({
        id: 'contact-1#2026-08',
        message: 'Scholarship record saved.',
      });
    });

    it('strips null/undefined fields — an emptied date must not reach dynamoose (regression)', async () => {
      // The form sends null for empty optional dates; dynamoose rejects null
      // for Date attributes ("Expected date_funds_requested_by_btc to be of
      // type date, instead found type null") and the whole save failed.
      Model.__save.mockResolvedValue(undefined);
      await service.upsertScholarshipRecord(
        sampleRecord({
          date_funds_requested_by_btc: null as never,
          invoice_paid_date: undefined,
        }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs).not.toHaveProperty('date_funds_requested_by_btc');
      expect(attrs).not.toHaveProperty('invoice_paid_date');
      expect(attrs.id).toBe('contact-1#2026-08');
    });

    it('coerces string and epoch dates to real Dates (non-HTTP callers)', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.upsertScholarshipRecord(
        sampleRecord({
          invoice_paid_date: '2026-09-15T04:00:00.000Z' as never,
          date_funds_requested_by_btc: 1789000000000 as never,
          date_funds_requested_by_family: '' as never,
        }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs.invoice_paid_date).toBeInstanceOf(Date);
      expect(attrs.invoice_paid_date.toISOString()).toBe(
        '2026-09-15T04:00:00.000Z',
      );
      expect(attrs.date_funds_requested_by_btc).toBeInstanceOf(Date);
      expect(attrs.date_funds_requested_by_btc.getTime()).toBe(1789000000000);
      // A blank string is "no date" — stripped like null.
      expect(attrs).not.toHaveProperty('date_funds_requested_by_family');
    });

    it('rejects an unparseable date without saving', async () => {
      await expect(
        service.upsertScholarshipRecord(
          sampleRecord({ invoice_paid_date: 'not-a-date' as never }),
        ),
      ).rejects.toThrow('Invalid date in scholarship record.');
      expect(Model.__save).not.toHaveBeenCalled();
    });

    it('propagates save failures', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(
        service.upsertScholarshipRecord(sampleRecord()),
      ).rejects.toThrow('save boom');
    });
  });
});
