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

    it('carries an amount_override through the PutItem and strips null/undefined fields', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.upsertBillingRecord({
        ...sampleRecord(),
        amount_override: 0,
        paid_date: undefined,
        invoice_number: null as unknown as string,
      });
      const attributes = (Model as jest.Mock).mock.calls.at(-1)![0] as Record<
        string,
        unknown
      >;
      expect(attributes.amount_override).toBe(0);
      expect('paid_date' in attributes).toBe(false);
      expect('invoice_number' in attributes).toBe(false);
      await service.upsertBillingRecord(sampleRecord());
      const plain = (Model as jest.Mock).mock.calls.at(-1)![0] as Record<
        string,
        unknown
      >;
      expect('amount_override' in plain).toBe(false);
    });
  });

  describe('setAmountOverride', () => {
    const request = (amount_override: number | null) => ({
      contact_id: 'contact-1',
      period_start: '2026-07-01',
      cycle: 'monthly',
      amount_override,
    });

    it('updates only the override on an existing record (paid state untouched)', async () => {
      Model.get.mockResolvedValue({ id: 'contact-1#2026-07-01', paid: true });
      Model.update.mockResolvedValue(undefined);
      await expect(service.setAmountOverride(request(150))).resolves.toEqual({
        id: 'contact-1#2026-07-01',
        message: 'Billing override saved.',
      });
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'contact-1#2026-07-01' },
        { $SET: { amount_override: 150 } },
      );
      expect(Model.create).not.toHaveBeenCalled();
    });

    it('accepts 0 as "no charge"', async () => {
      Model.get.mockResolvedValue({ id: 'contact-1#2026-07-01' });
      Model.update.mockResolvedValue(undefined);
      await service.setAmountOverride(request(0));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'contact-1#2026-07-01' },
        { $SET: { amount_override: 0 } },
      );
    });

    it('clears the override with a $REMOVE', async () => {
      Model.get.mockResolvedValue({ id: 'contact-1#2026-07-01' });
      Model.update.mockResolvedValue(undefined);
      await expect(service.setAmountOverride(request(null))).resolves.toEqual({
        id: 'contact-1#2026-07-01',
        message: 'Billing override cleared.',
      });
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'contact-1#2026-07-01' },
        { $REMOVE: ['amount_override'] },
      );
    });

    it('creates a minimal unpaid record when none exists yet', async () => {
      Model.get.mockResolvedValue(undefined);
      Model.create.mockResolvedValue(undefined);
      await service.setAmountOverride(request(99.5));
      expect(Model.create).toHaveBeenCalledWith({
        id: 'contact-1#2026-07-01',
        contact_id: 'contact-1',
        period_start: '2026-07-01',
        cycle: 'monthly',
        amount: 99.5,
        paid: false,
        amount_override: 99.5,
      });
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('clearing a never-recorded period is a no-op', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.setAmountOverride(request(null))).resolves.toEqual({
        id: 'contact-1#2026-07-01',
        message: 'No billing record to clear.',
      });
      expect(Model.create).not.toHaveBeenCalled();
      expect(Model.update).not.toHaveBeenCalled();
    });

    it.each([
      -1,
      NaN,
      Infinity,
      '12' as unknown as number,
      undefined as unknown as number,
    ])('rejects an invalid override %p with a 400', async (bad) => {
      await expect(service.setAmountOverride(request(bad))).rejects.toThrow(
        'amount_override must be a non-negative number, or null to clear.',
      );
      expect(Model.get).not.toHaveBeenCalled();
    });

    it('rejects a request missing contact or period with a 400', async () => {
      await expect(
        service.setAmountOverride({ ...request(10), period_start: '' }),
      ).rejects.toThrow('contact_id and period_start are required.');
    });

    it('rejects when the read, update, or create fails', async () => {
      Model.get.mockRejectedValue(new Error('get boom'));
      await expect(service.setAmountOverride(request(10))).rejects.toThrow(
        'get boom',
      );
      Model.get.mockResolvedValue({ id: 'x' });
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.setAmountOverride(request(10))).rejects.toThrow(
        'update boom',
      );
      Model.get.mockResolvedValue(undefined);
      Model.create.mockRejectedValue(new Error('create boom'));
      await expect(service.setAmountOverride(request(10))).rejects.toThrow(
        'create boom',
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
