import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { ScholarshipsController } from './scholarships.controller';
import { ScholarshipsService } from './scholarships.service';
import { User } from '../models/user.model';
import { ScholarshipRecord } from '../models/scholarship-record.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};
const groupless: User = {
  username: 'nogroups',
  email: 'nogroups@example.com',
  groups: undefined as unknown as string[],
  contact: 'c-nogroups',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const record = { contact_id: 'c-1', month: '2026-08' } as ScholarshipRecord;

describe('ScholarshipsController', () => {
  let controller: ScholarshipsController;
  let service: jest.Mocked<ScholarshipsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<ScholarshipsService>> = {
      getScholarshipRecords: jest.fn(),
      getScholarshipRecordsByContact: jest.fn(),
      getScholarshipRecordsByMonth: jest.fn(),
      upsertScholarshipRecord: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScholarshipsController],
      providers: [{ provide: ScholarshipsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(ScholarshipsController);
    service = module.get(ScholarshipsService);
  });

  it('admin gets all records with no query params', async () => {
    await controller.getScholarshipRecords(reqAs(admin), '', '');
    expect(service.getScholarshipRecords).toHaveBeenCalled();
  });

  it('the contact param wins over month', async () => {
    await controller.getScholarshipRecords(reqAs(admin), 'c-1', '2026-08');
    expect(service.getScholarshipRecordsByContact).toHaveBeenCalledWith('c-1');
    expect(service.getScholarshipRecordsByMonth).not.toHaveBeenCalled();
  });

  it('the month param scopes the read', async () => {
    await controller.getScholarshipRecords(reqAs(admin), '', '2026-08');
    expect(service.getScholarshipRecordsByMonth).toHaveBeenCalledWith(
      '2026-08',
    );
  });

  it('admin can upsert a record', async () => {
    await controller.upsertScholarshipRecord(reqAs(admin), record);
    expect(service.upsertScholarshipRecord).toHaveBeenCalledWith(record);
  });

  it('non-admins are rejected on both routes', async () => {
    await expect(
      controller.getScholarshipRecords(reqAs(tutor), '', ''),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.upsertScholarshipRecord(reqAs(tutor), record),
    ).rejects.toThrow('Unauthorized');
    expect(service.getScholarshipRecords).not.toHaveBeenCalled();
    expect(service.upsertScholarshipRecord).not.toHaveBeenCalled();
  });

  it('a user with no cognito groups is rejected, not crashed', async () => {
    await expect(
      controller.getScholarshipRecords(reqAs(groupless), '', ''),
    ).rejects.toThrow('Unauthorized');
    await expect(
      controller.upsertScholarshipRecord(reqAs(groupless), record),
    ).rejects.toThrow('Unauthorized');
  });
});
