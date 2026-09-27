import { Test, TestingModule } from '@nestjs/testing';
import { StatementService } from './statement.service';
import { BillingService } from './billing.service';
import { StudentsService } from '../students/students.service';
import { ContactsService } from '../contacts/contacts.service';
import { PackagesService } from '../packages/packages.service';
import { Student } from '../models/student.model';

const catalog = {
  Start: { monthlyCost: 273, sessionsPerWeek: 1, sessionLengthMin: 45 },
};
const MONDAY = [{ weekday: 'MONDAY', start_time: '10:00', end_time: '10:45' }];
const pat = {
  id: 's-1',
  contact_id: 'c-1',
  name: 'Pat',
  status: 'Active Student',
  package: 'Start',
  package_start_date: '2026-05-01T00:00:00',
  schedule: MONDAY,
} as unknown as Student;
const robin = { id: 'c-1', first_name: 'Robin', last_name: 'Reed' };

describe('StatementService', () => {
  let service: StatementService;
  const students = { getStudents: jest.fn() };
  const contacts = { getContacts: jest.fn() };
  const packages = { getCatalog: jest.fn() };
  const billing = { getBillingRecordsByMonth: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatementService,
        { provide: StudentsService, useValue: students },
        { provide: ContactsService, useValue: contacts },
        { provide: PackagesService, useValue: packages },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();
    service = module.get(StatementService);
    students.getStudents.mockResolvedValue([pat]);
    contacts.getContacts.mockResolvedValue([robin]);
    packages.getCatalog.mockResolvedValue(catalog);
    billing.getBillingRecordsByMonth.mockResolvedValue([]);
  });

  describe('getStatements', () => {
    it('builds the month from students, contacts, records and catalog', async () => {
      billing.getBillingRecordsByMonth.mockResolvedValue([
        {
          contact_id: 'c-1',
          period_start: '2026-09-01',
          paid: true,
          amount_override: 250,
        },
      ]);
      const res = await service.getStatements('2026-09');
      expect(billing.getBillingRecordsByMonth).toHaveBeenCalledWith('2026-09');
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual(
        expect.objectContaining({
          contact_name: 'Robin Reed',
          month: '2026-09',
          total: 273,
          total_due: 250,
        }),
      );
      expect(res[0].dues[0].paid).toBe(true);
    });

    it('uses the requested month', async () => {
      students.getStudents.mockResolvedValue([
        { ...pat, package_start_date: '2026-09-14T00:00:00' },
      ]);
      expect((await service.getStatements('2026-09'))[0].total).toBe(189);
      expect((await service.getStatements('2026-10'))[0].total).toBe(273);
      expect(await service.getStatements('2026-08')).toEqual([]);
    });

    it.each(['', '2026', '2026-13', '09-2026', undefined])(
      'rejects the month %p before loading anything',
      async (month) => {
        await expect(
          service.getStatements(month as unknown as string),
        ).rejects.toThrow('month must be formatted YYYY-MM.');
        expect(packages.getCatalog).not.toHaveBeenCalled();
        expect(students.getStudents).not.toHaveBeenCalled();
      },
    );

    it('fails loudly on an empty catalog', async () => {
      packages.getCatalog.mockResolvedValue({});
      await expect(service.getStatements('2026-09')).rejects.toThrow(
        'The package catalog is unavailable.',
      );
      expect(students.getStudents).not.toHaveBeenCalled();
    });
  });

  describe('previewStatement', () => {
    it('replaces the saved student with the draft', async () => {
      const res = await service.previewStatement({
        month: '2026-09',
        student: { ...pat, discount_percent: 10 } as Student,
      });
      expect(res!.lines).toHaveLength(1);
      expect(res!.total).toBe(245.7);
      expect(billing.getBillingRecordsByMonth).toHaveBeenCalledWith('2026-09');
    });

    it('adds an unsaved student to the family', async () => {
      const res = await service.previewStatement({
        month: '2026-09',
        student: { ...pat, id: undefined, name: 'New' } as Student,
      });
      expect(res!.lines.map((l) => l.student_name)).toEqual(['Pat', 'New']);
      expect(res!.total).toBe(546);
    });

    it('returns null when the family would owe nothing', async () => {
      students.getStudents.mockResolvedValue([]);
      const res = await service.previewStatement({
        month: '2026-09',
        student: { ...pat, status: 'Onboarding' } as Student,
      });
      expect(res).toBeNull();
    });

    it('rejects a bad month', async () => {
      await expect(
        service.previewStatement({ month: 'nope', student: pat }),
      ).rejects.toThrow('month must be formatted YYYY-MM.');
      await expect(
        service.previewStatement(undefined as never),
      ).rejects.toThrow('month must be formatted YYYY-MM.');
    });

    it('requires a student with a contact', async () => {
      await expect(
        service.previewStatement({
          month: '2026-09',
          student: undefined as unknown as Student,
        }),
      ).rejects.toThrow('student.contact_id is required.');
      await expect(
        service.previewStatement({
          month: '2026-09',
          student: { ...pat, contact_id: '' } as Student,
        }),
      ).rejects.toThrow('student.contact_id is required.');
      expect(packages.getCatalog).not.toHaveBeenCalled();
    });

    it('rejects an unknown contact', async () => {
      await expect(
        service.previewStatement({
          month: '2026-09',
          student: { ...pat, contact_id: 'c-9' } as Student,
        }),
      ).rejects.toThrow('Contact not found.');
    });

    it('fails loudly on an empty catalog', async () => {
      packages.getCatalog.mockResolvedValue({});
      await expect(
        service.previewStatement({ month: '2026-09', student: pat }),
      ).rejects.toThrow('The package catalog is unavailable.');
    });
  });
});
