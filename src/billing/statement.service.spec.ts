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
  const billing = {
    getBillingRecordsByMonth: jest.fn(),
    getFrozenStatements: jest.fn(),
    createFrozenStatementIfAbsent: jest.fn(),
  };
  // Sept 28 2026, mid-morning Eastern: September is the current month.
  const NOW = new Date('2026-09-28T14:00:00Z');

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
    billing.getFrozenStatements.mockResolvedValue([]);
    billing.createFrozenStatementIfAbsent.mockResolvedValue(true);
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
      const res = await service.getStatements('2026-09', NOW);
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
      expect((await service.getStatements('2026-09', NOW))[0].total).toBe(189);
      expect((await service.getStatements('2026-10', NOW))[0].total).toBe(273);
      expect(await service.getStatements('2026-08', NOW)).toEqual([]);
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
      await expect(service.getStatements('2026-09', NOW)).rejects.toThrow(
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

  describe('frozen months', () => {
    const frozenAug = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        contact_id: 'c-1',
        contact_name: 'Robin Reed',
        month: '2026-08',
        cycle: 'monthly',
        lines: [{ student_name: 'Pat', package: 'Old', amount: 199, net: 199 }],
        total: 199,
        dues: [
          {
            day: 1,
            period_start: '2026-08-01',
            derived: 199,
            override: null,
            amount: 199,
            paid: false,
          },
        ],
        total_due: 199,
        flags: [],
        frozen_at: '2026-09-01T06:00:00.000Z',
        ...over,
      });

    it("serves a closed month from its stored copy, not from today's students", async () => {
      billing.getFrozenStatements.mockResolvedValue([frozenAug()]);
      billing.getBillingRecordsByMonth.mockResolvedValue([
        { contact_id: 'c-1', period_start: '2026-08-01', paid: true },
      ]);
      const res = await service.getStatements('2026-08', NOW);
      expect(billing.getFrozenStatements).toHaveBeenCalledWith('2026-08');
      expect(res).toHaveLength(1);
      // Today's student is on Start at $273; August was billed $199.
      expect(res[0].total).toBe(199);
      expect(res[0].lines[0].package).toBe('Old');
      expect(res[0].frozen_at).toBe('2026-09-01T06:00:00.000Z');
      // The paid state is still live.
      expect(res[0].dues[0].paid).toBe(true);
      expect(students.getStudents).not.toHaveBeenCalled();
      expect(packages.getCatalog).not.toHaveBeenCalled();
    });

    it('sorts stored statements by family name', async () => {
      billing.getFrozenStatements.mockResolvedValue([
        frozenAug({ contact_id: 'c-2', contact_name: 'Zed Young' }),
        frozenAug({ contact_id: 'c-3', contact_name: 'Amy Adams' }),
      ]);
      const res = await service.getStatements('2026-08', NOW);
      expect(res.map((s) => s.contact_name)).toEqual([
        'Amy Adams',
        'Zed Young',
      ]);
    });

    it('skips an unreadable or malformed stored statement', async () => {
      billing.getFrozenStatements.mockResolvedValue([
        '{not json',
        JSON.stringify(null),
        JSON.stringify({ contact_id: '', dues: [] }),
        JSON.stringify({ contact_id: 'c-9' }),
        frozenAug(),
      ]);
      const res = await service.getStatements('2026-08', NOW);
      expect(res.map((s) => s.contact_id)).toEqual(['c-1']);
    });

    it('calculates a closed month that was never frozen', async () => {
      const res = await service.getStatements('2026-08', NOW);
      expect(billing.getFrozenStatements).toHaveBeenCalledWith('2026-08');
      expect(res[0].total).toBe(273);
      expect(res[0].frozen_at).toBeUndefined();
    });

    it('always calculates the current and future months', async () => {
      billing.getFrozenStatements.mockResolvedValue([frozenAug()]);
      await service.getStatements('2026-09', NOW);
      await service.getStatements('2026-10', NOW);
      expect(billing.getFrozenStatements).not.toHaveBeenCalled();
    });

    it('uses the Eastern month at the boundary', async () => {
      billing.getFrozenStatements.mockResolvedValue([
        frozenAug({ month: '2026-09' }),
      ]);
      // 03:00 UTC on Oct 1 is still Sept 30 in New York: September is open.
      await service.getStatements('2026-09', new Date('2026-10-01T03:00:00Z'));
      expect(billing.getFrozenStatements).not.toHaveBeenCalled();
      await service.getStatements('2026-09', new Date('2026-10-01T04:00:00Z'));
      expect(billing.getFrozenStatements).toHaveBeenCalledWith('2026-09');
    });
  });

  describe('freezeMonth', () => {
    it("stores every family's statement for a closed month", async () => {
      const res = await service.freezeMonth('2026-08', NOW);
      expect(res).toEqual({ month: '2026-08', frozen: 1 });
      expect(billing.getBillingRecordsByMonth).toHaveBeenCalledWith('2026-08');
      const [item] = billing.createFrozenStatementIfAbsent.mock.calls[0];
      expect(item).toEqual({
        contact_id: 'c-1',
        month: '2026-08',
        frozen_at: NOW.toISOString(),
        statement: expect.any(String),
      });
      const stored = JSON.parse(item.statement);
      expect(stored.total).toBe(273);
      expect(stored.month).toBe('2026-08');
      expect(stored.frozen_at).toBe(NOW.toISOString());
      expect(stored.lines).toHaveLength(1);
    });

    it('counts only what it wrote: a family already frozen is left alone', async () => {
      contacts.getContacts.mockResolvedValue([
        robin,
        { id: 'c-2', first_name: 'Sam', last_name: 'Roe' },
      ]);
      students.getStudents.mockResolvedValue([
        pat,
        { ...pat, id: 's-2', contact_id: 'c-2' },
      ]);
      billing.createFrozenStatementIfAbsent
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const res = await service.freezeMonth('2026-08', NOW);
      expect(billing.createFrozenStatementIfAbsent).toHaveBeenCalledTimes(2);
      expect(res.frozen).toBe(1);
    });

    it('refuses the current month and any later one', async () => {
      for (const month of ['2026-09', '2026-10', '2027-01']) {
        await expect(service.freezeMonth(month, NOW)).rejects.toThrow(
          'Only a month that has ended can be frozen.',
        );
      }
      expect(billing.createFrozenStatementIfAbsent).not.toHaveBeenCalled();
      expect(students.getStudents).not.toHaveBeenCalled();
    });

    it('rejects a malformed month', async () => {
      await expect(service.freezeMonth('2026-8', NOW)).rejects.toThrow(
        'month must be formatted YYYY-MM.',
      );
    });

    it('uses inputs the caller already loaded', async () => {
      const res = await service.freezeMonth('2026-08', NOW, {
        students: [pat],
        contacts: [robin] as never,
        catalog,
      });
      expect(res.frozen).toBe(1);
      expect(students.getStudents).not.toHaveBeenCalled();
      expect(contacts.getContacts).not.toHaveBeenCalled();
      expect(packages.getCatalog).not.toHaveBeenCalled();
    });

    it('fails loudly on an empty catalog and writes nothing', async () => {
      packages.getCatalog.mockResolvedValue({});
      await expect(service.freezeMonth('2026-08', NOW)).rejects.toThrow(
        'The package catalog is unavailable.',
      );
      expect(billing.createFrozenStatementIfAbsent).not.toHaveBeenCalled();
    });

    it('writes nothing for a month nobody was billed', async () => {
      students.getStudents.mockResolvedValue([]);
      expect(await service.freezeMonth('2026-08', NOW)).toEqual({
        month: '2026-08',
        frozen: 0,
      });
    });

    it('rejects when a write fails', async () => {
      billing.createFrozenStatementIfAbsent.mockRejectedValue(
        new Error('boom'),
      );
      await expect(service.freezeMonth('2026-08', NOW)).rejects.toThrow('boom');
    });
  });
});
