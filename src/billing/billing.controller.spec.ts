import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { User } from '../models/user.model';
import { BillingRecord } from '../models/billing-record.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'contact-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'contact-tutor',
};

const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

describe('BillingController', () => {
  let controller: BillingController;
  let service: jest.Mocked<BillingService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<BillingService>> = {
      getBillingRecords: jest.fn(),
      getBillingRecordsByContact: jest.fn(),
      getBillingRecordsByPeriod: jest.fn(),
      getBillingRecordsByMonth: jest.fn(),
      upsertBillingRecord: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: serviceMock }],
    }).compile();
    controller = module.get(BillingController);
    service = module.get(BillingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getBillingRecords', () => {
    it('admin fetches by contact', async () => {
      service.getBillingRecordsByContact.mockResolvedValue([] as never);
      await controller.getBillingRecords(reqAs(admin), 'c-1', '', '');
      expect(service.getBillingRecordsByContact).toHaveBeenCalledWith('c-1');
    });

    it('admin fetches by period', async () => {
      service.getBillingRecordsByPeriod.mockResolvedValue([] as never);
      await controller.getBillingRecords(reqAs(admin), '', '2026-07-01', '');
      expect(service.getBillingRecordsByPeriod).toHaveBeenCalledWith(
        '2026-07-01',
      );
    });

    it('admin fetches by month', async () => {
      await controller.getBillingRecords(reqAs(admin), '', '', '2026-07');
      expect(service.getBillingRecordsByMonth).toHaveBeenCalledWith('2026-07');
      expect(service.getBillingRecords).not.toHaveBeenCalled();
    });

    it('admin lists all when no filter is given', async () => {
      service.getBillingRecords.mockResolvedValue([] as never);
      await controller.getBillingRecords(reqAs(admin), '', '', '');
      expect(service.getBillingRecords).toHaveBeenCalled();
    });

    it('non-admin is unauthorized', async () => {
      await expect(
        controller.getBillingRecords(reqAs(tutor), '', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('treats a missing groups array as non-admin', async () => {
      const noGroups = { ...tutor, groups: undefined } as unknown as User;
      await expect(
        controller.getBillingRecords(reqAs(noGroups), '', '', ''),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('upsertBillingRecord', () => {
    const record: BillingRecord = {
      contact_id: 'c-1',
      period_start: '2026-07-01',
      cycle: 'monthly',
      amount: 362,
      paid: true,
    };

    it('admin upserts a record', async () => {
      service.upsertBillingRecord.mockResolvedValue({
        id: 'x',
        message: 'ok',
      } as never);
      await controller.upsertBillingRecord(reqAs(admin), record);
      expect(service.upsertBillingRecord).toHaveBeenCalledWith(record);
    });

    it('non-admin is unauthorized', async () => {
      await expect(
        controller.upsertBillingRecord(reqAs(tutor), record),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
