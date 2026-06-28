import { AutoRenewService } from './auto-renew.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';

describe('AutoRenewService', () => {
  let service: AutoRenewService;
  const students = { getStudents: jest.fn() };
  const sessions = { createSessions: jest.fn() };
  const contacts = { getContacts: jest.fn() };
  const billing = {
    acquireLock: jest.fn(),
    createBillingRecordIfAbsent: jest.fn(),
  };

  const student = (over: Partial<Student> = {}): Student =>
    ({
      id: 's-1',
      contact_id: 'c-1',
      name: 'Pat',
      status: 'Active Student',
      assigned_tutor_id: 't-1',
      package: 'Succeed', // $362/mo, 2×30min
      auto_renew: true,
      package_start_date: '2026-05-01T00:00:00', // before July
      schedule: [
        { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:30' },
      ],
      ...over,
    }) as Student;

  const parent = (over: Partial<Contact> = {}): Contact =>
    ({
      id: 'c-1',
      first_name: 'Casey',
      billing_cycle: 'monthly',
      ...over,
    }) as Contact;
  const tutor = (): Contact => ({ id: 't-1', first_name: 'Tess' }) as Contact;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new AutoRenewService(
      students as any,
      sessions as any,
      contacts as any,
      billing as any,
    );
    billing.acquireLock.mockResolvedValue(true);
    billing.createBillingRecordIfAbsent.mockResolvedValue({
      id: 'x',
      created: true,
    });
    sessions.createSessions.mockResolvedValue({});
    students.getStudents.mockResolvedValue([student()]);
    contacts.getContacts.mockResolvedValue([parent(), tutor()]);
  });

  // July 2026: Mondays 6,13,20,27 (4) + Wednesdays 1,8,15,22,29 (5) = 9 sessions.
  const july = new Date(2026, 6, 1);

  it('skips the whole run when the lock is already held', async () => {
    billing.acquireLock.mockResolvedValue(false);
    const result = await service.runAutoRenew(july);
    expect(result.skipped).toBe(true);
    expect(sessions.createSessions).not.toHaveBeenCalled();
    expect(billing.createBillingRecordIfAbsent).not.toHaveBeenCalled();
  });

  it('generates the new month of sessions for an auto-renew student', async () => {
    const result = await service.runAutoRenew(july);
    expect(sessions.createSessions).toHaveBeenCalledTimes(1);
    const created = sessions.createSessions.mock.calls[0][0];
    expect(created).toHaveLength(9);
    expect(created[0].tutor_name).toBe('Tess');
    expect(
      created.every((s: any) => s.series_id === created[0].series_id),
    ).toBe(true);
    expect(result.sessionsCreated).toBe(9);
  });

  it('creates a single monthly billing record at the full cost', async () => {
    const result = await service.runAutoRenew(july);
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledTimes(1);
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'c-1',
        period_start: '2026-07-01',
        cycle: 'monthly',
        amount: 362,
        paid: false,
      }),
    );
    expect(result.billingRecords).toBe(1);
  });

  it('splits semi-monthly contacts into two records', async () => {
    contacts.getContacts.mockResolvedValue([
      parent({ billing_cycle: 'semi_monthly' }),
      tutor(),
    ]);
    await service.runAutoRenew(july);
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledTimes(2);
    const periods = billing.createBillingRecordIfAbsent.mock.calls.map(
      (c) => c[0].period_start,
    );
    expect(periods).toEqual(['2026-07-01', '2026-07-15']);
  });

  it('does not double-renew a student who started in the current month', async () => {
    students.getStudents.mockResolvedValue([
      student({ package_start_date: '2026-07-10T00:00:00' }),
    ]);
    const result = await service.runAutoRenew(july);
    expect(sessions.createSessions).not.toHaveBeenCalled();
    expect(result.sessionsCreated).toBe(0);
  });

  it('ignores students without auto-renew', async () => {
    students.getStudents.mockResolvedValue([student({ auto_renew: false })]);
    const result = await service.runAutoRenew(july);
    expect(sessions.createSessions).not.toHaveBeenCalled();
    expect(result.billingRecords).toBe(0);
  });

  it('does not count a billing record that already existed', async () => {
    billing.createBillingRecordIfAbsent.mockResolvedValue({
      id: 'x',
      created: false,
    });
    const result = await service.runAutoRenew(july);
    expect(result.billingRecords).toBe(0);
  });

  it('the @Cron handler runs the renewal for the current month', async () => {
    await service.handleMonthlyRenewal();
    expect(billing.acquireLock).toHaveBeenCalled();
  });
});
