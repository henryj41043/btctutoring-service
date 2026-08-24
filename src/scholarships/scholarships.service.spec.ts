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

    it('propagates save failures', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(
        service.upsertScholarshipRecord(sampleRecord()),
      ).rejects.toThrow('save boom');
    });
  });
});
