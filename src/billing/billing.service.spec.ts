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
      expect(Model.scan).toHaveBeenCalledWith({
        contact_id: { eq: 'contact-1' },
      });
    });

    it('getBillingRecordsByPeriod scans by period_start', async () => {
      scanResolves(Model, []);
      await service.getBillingRecordsByPeriod('2026-07-01');
      expect(Model.scan).toHaveBeenCalledWith({
        period_start: { eq: '2026-07-01' },
      });
    });

    it('getBillingRecordsByMonth prefix-matches period_start and paginates fully', async () => {
      const chain = scanResolves(Model, [{ id: 'c-1#2026-07-01' }]);
      const result = await service.getBillingRecordsByMonth('2026-07');
      expect(chain.where).toHaveBeenCalledWith('period_start');
      expect(chain.beginsWith).toHaveBeenCalledWith('2026-07');
      expect(chain.all).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'c-1#2026-07-01' }]);
    });

    it('getBillingRecordsByMonth rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getBillingRecordsByMonth('2026-07')).rejects.toThrow(
        'scan boom',
      );
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

  describe('createBillingRecordIfAbsent', () => {
    beforeEach(() => {
      (Model as unknown as { create: jest.Mock }).create = jest.fn();
    });

    it('creates a record when none exists', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockResolvedValue({});
      const result = await service.createBillingRecordIfAbsent(sampleRecord());
      expect(result).toEqual({ id: 'contact-1#2026-07-01', created: true });
    });

    it('returns created:false when the record already exists (by error name)', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockRejectedValue({
        name: 'ConditionalCheckFailedException',
      });
      const result = await service.createBillingRecordIfAbsent(sampleRecord());
      expect(result.created).toBe(false);
    });

    it('returns created:false when the record already exists (by message)', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockRejectedValue({
        message: 'Item already exists',
      });
      const result = await service.createBillingRecordIfAbsent(sampleRecord());
      expect(result.created).toBe(false);
    });

    it('rejects on an unexpected error', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockRejectedValue(
        new Error('boom'),
      );
      await expect(
        service.createBillingRecordIfAbsent(sampleRecord()),
      ).rejects.toThrow('boom');
    });
  });

  describe('acquireLock', () => {
    beforeEach(() => {
      (Model as unknown as { create: jest.Mock }).create = jest.fn();
    });

    it('returns true when the lock is created', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockResolvedValue({});
      expect(await service.acquireLock('lock#x')).toBe(true);
    });

    it('returns false when the lock is already held', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockRejectedValue({
        name: 'ConditionalCheckFailedException',
      });
      expect(await service.acquireLock('lock#x')).toBe(false);
    });

    it('rejects on an unexpected error', async () => {
      (Model as unknown as { create: jest.Mock }).create.mockRejectedValue(
        new Error('boom'),
      );
      await expect(service.acquireLock('lock#x')).rejects.toThrow('boom');
    });
  });
});
