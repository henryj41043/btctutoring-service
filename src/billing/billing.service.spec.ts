import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service';
import { BillingModel } from '../models/billing.model';
import { BillingRecord } from '../models/billing-record.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/billing.model', () => ({
  BillingModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = BillingModel as unknown as ModelMock;

const sampleRecord = (overrides: Partial<BillingRecord> = {}): BillingRecord =>
  ({
    contact_id: 'contact-1',
    period_start: '2026-07-01',
    cycle: 'monthly',
    amount: 362,
    paid: false,
    ...overrides,
  }) as BillingRecord;

describe('BillingService', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BillingService],
    }).compile();
    service = module.get<BillingService>(BillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds a deterministic record id from contact + period', () => {
    expect(BillingService.recordId('contact-1', '2026-07-15')).toBe(
      'contact-1#2026-07-15',
    );
  });

  describe('read queries', () => {
    it('getBillingRecordsByContact scans by contact_id', async () => {
      scanResolves(Model, []);
      await service.getBillingRecordsByContact('contact-1');
      expect(Model.scan).toHaveBeenCalledWith({ contact_id: { eq: 'contact-1' } });
    });

    it('getBillingRecordsByPeriod scans by period_start', async () => {
      scanResolves(Model, []);
      await service.getBillingRecordsByPeriod('2026-07-01');
      expect(Model.scan).toHaveBeenCalledWith({ period_start: { eq: '2026-07-01' } });
    });

    it('getBillingRecords scans everything', async () => {
      scanResolves(Model, []);
      await service.getBillingRecords();
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it('rejects when a scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getBillingRecords()).rejects.toThrow('scan boom');
    });
  });

  describe('upsertBillingRecord', () => {
    it('saves with a deterministic id and returns it', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.upsertBillingRecord(sampleRecord());
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: 'contact-1#2026-07-01',
        message: 'Billing record saved.',
      });
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.upsertBillingRecord(sampleRecord())).rejects.toThrow(
        'save boom',
      );
    });
  });
});
