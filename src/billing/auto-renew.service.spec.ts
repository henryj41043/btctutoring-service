import { AutoRenewService } from './auto-renew.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';

describe('AutoRenewService', () => {
  let service: AutoRenewService;
  const students = { getStudents: jest.fn() };
  const sessions = { createSessions: jest.fn(), getAllSessions: jest.fn() };
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
    sessions.getAllSessions.mockResolvedValue([]);
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

  it('pins session times to Eastern wall time in summer (EDT, UTC-4)', async () => {
    await service.runAutoRenew(july);
    const created = sessions.createSessions.mock.calls[0][0];
    // First Monday of July 2026 is the 6th; 10:00 AM EDT = 14:00Z. Regression
    // for the cron generating in the container's UTC clock (4-5h early).
    expect(created[0].start_datetime).toBe('2026-07-06T14:00:00.000Z');
    expect(created[0].end_datetime).toBe('2026-07-06T14:30:00.000Z');
  });

  it('pins session times to Eastern wall time in winter (EST, UTC-5)', async () => {
    students.getStudents.mockResolvedValue([
      student({ package_start_date: '2025-12-01T00:00:00' }),
    ]);
    await service.runAutoRenew(new Date(2026, 0, 1));
    const created = sessions.createSessions.mock.calls[0][0];
    // First Monday of January 2026 is the 5th; 10:00 AM EST = 15:00Z.
    expect(created[0].start_datetime).toBe('2026-01-05T15:00:00.000Z');
    expect(created[0].end_datetime).toBe('2026-01-05T15:30:00.000Z');
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

  it('applies the sibling discount when 3+ students are enrolled', async () => {
    students.getStudents.mockResolvedValue([
      student({ id: 's-1' }),
      student({ id: 's-2' }),
      student({ id: 's-3' }),
    ]);
    contacts.getContacts.mockResolvedValue([
      parent({ sibling_discount: 10 }),
      tutor(),
    ]);
    await service.runAutoRenew(july);
    // 3 × $362 = $1086, less 10% = $977.40.
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 977.4 }),
    );
  });

  it('does not discount a two-student family (below the 3+ threshold)', async () => {
    students.getStudents.mockResolvedValue([
      student({ id: 's-1' }),
      student({ id: 's-2' }),
    ]);
    contacts.getContacts.mockResolvedValue([
      parent({ sibling_discount: 10 }),
      tutor(),
    ]);
    await service.runAutoRenew(july);
    // 2 × $362 with NO discount — the threshold is now 3 students.
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 724 }),
    );
  });

  it('does not apply the sibling discount to an only child', async () => {
    contacts.getContacts.mockResolvedValue([
      parent({ sibling_discount: 10 }),
      tutor(),
    ]);
    await service.runAutoRenew(july);
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 362 }),
    );
  });

  it('does not discount when only one of two students is enrolled', async () => {
    students.getStudents.mockResolvedValue([
      student({ id: 's-1' }),
      student({
        id: 's-2',
        package: undefined,
        auto_renew: false,
        schedule: undefined,
      }),
    ]);
    contacts.getContacts.mockResolvedValue([
      parent({ sibling_discount: 10 }),
      tutor(),
    ]);
    await service.runAutoRenew(july);
    expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 362 }),
    );
  });

  it('the @Cron handler runs the renewal for the current month', async () => {
    await service.handleMonthlyRenewal();
    expect(billing.acquireLock).toHaveBeenCalled();
  });

  describe('BTC & Me billing fee', () => {
    it('adds the flat $75 per enrolled student to a monthly record', async () => {
      students.getStudents.mockResolvedValue([student({ btc_and_me: true })]);
      await service.runAutoRenew(july);
      expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 437 }), // 362 + 75
      );
    });

    it('bills a group-only family that has no packaged student', async () => {
      students.getStudents.mockResolvedValue([
        student({
          package: undefined,
          auto_renew: false,
          schedule: undefined,
          btc_and_me: true,
        }),
      ]);
      const result = await service.runAutoRenew(july);
      expect(sessions.createSessions).not.toHaveBeenCalled();
      expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_id: 'c-1',
          period_start: '2026-07-01',
          cycle: 'monthly',
          amount: 75,
          paid: false,
        }),
      );
      expect(result.billingRecords).toBe(1);
    });

    it('lands the whole fee on the 1st for semi-monthly families', async () => {
      students.getStudents.mockResolvedValue([student({ btc_and_me: true })]);
      contacts.getContacts.mockResolvedValue([
        parent({ billing_cycle: 'semi_monthly' }),
        tutor(),
      ]);
      await service.runAutoRenew(july);
      const calls = billing.createBillingRecordIfAbsent.mock.calls.map(
        (c) => c[0],
      );
      expect(calls).toEqual([
        expect.objectContaining({ period_start: '2026-07-01', amount: 256 }), // 181 + 75
        expect.objectContaining({ period_start: '2026-07-15', amount: 181 }),
      ]);
    });

    it('a fee-only semi-monthly family gets just the day-1 record', async () => {
      students.getStudents.mockResolvedValue([
        student({
          package: undefined,
          auto_renew: false,
          schedule: undefined,
          btc_and_me: true,
        }),
      ]);
      contacts.getContacts.mockResolvedValue([
        parent({ billing_cycle: 'semi_monthly' }),
        tutor(),
      ]);
      await service.runAutoRenew(july);
      expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledTimes(1);
      expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ period_start: '2026-07-01', amount: 75 }),
      );
    });

    it('never sibling-discounts the group fee', async () => {
      students.getStudents.mockResolvedValue([
        student({ id: 's-1', btc_and_me: true }),
        student({ id: 's-2', btc_and_me: true }),
        student({ id: 's-3', btc_and_me: true }),
      ]);
      contacts.getContacts.mockResolvedValue([
        parent({ sibling_discount: 10 }),
        tutor(),
      ]);
      await service.runAutoRenew(july);
      // Packages: 3 × $362 less 10% = $977.40; fee added after: + 3 × $75.
      expect(billing.createBillingRecordIfAbsent).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1202.4 }),
      );
    });

    it('skips a contact whose charges and fee are both zero', async () => {
      // Renewable (auto_renew + schedule + old start) but the package is
      // unresolvable, so the charge is $0 and there is no group fee.
      students.getStudents.mockResolvedValue([student({ package: 'Bogus' })]);
      const result = await service.runAutoRenew(july);
      expect(billing.createBillingRecordIfAbsent).not.toHaveBeenCalled();
      expect(result.billingRecords).toBe(0);
    });

    it('inactive students never accrue the fee', async () => {
      students.getStudents.mockResolvedValue([
        student({
          package: undefined,
          auto_renew: false,
          schedule: undefined,
          btc_and_me: true,
          status: 'Past Student',
        }),
      ]);
      const result = await service.runAutoRenew(july);
      expect(billing.createBillingRecordIfAbsent).not.toHaveBeenCalled();
      expect(result.billingRecords).toBe(0);
    });
  });

  describe('BTC & Me group-roll', () => {
    // A Wednesday 5:00 PM EDT series in June–July 2026.
    const groupSession = (over: Record<string, unknown> = {}) => ({
      id: 'g-1',
      type: 'GROUP',
      status: 'Pending',
      start_datetime: '2026-07-29T21:00:00.000Z', // Wed Jul 29, 5pm EDT
      end_datetime: '2026-07-29T21:45:00.000Z',
      tutor_id: 't-1',
      tutor_name: 'Tess',
      student_name: 'Ava, Ben',
      participants: [
        { id: 's-a', name: 'Ava' },
        { id: 's-b', name: 'Ben' },
      ],
      series_id: 'series-1',
      notes: 'old notes',
      ...over,
    });

    beforeEach(() => {
      // No renewable tutoring students — isolate the group roll.
      students.getStudents.mockResolvedValue([student({ auto_renew: false })]);
    });

    it('rolls a pending series into next month, copying the latest occurrence', async () => {
      // Latest occurrence listed FIRST — the roll must pick by date, not order.
      sessions.getAllSessions.mockResolvedValue([
        groupSession(), // latest: Jul 29, roster Ava+Ben
        groupSession({
          id: 'g-0',
          start_datetime: '2026-07-22T21:00:00.000Z',
          status: 'Completed',
          participants: [{ id: 's-a', name: 'Ava' }],
          student_name: 'Ava',
        }),
      ]);
      const result = await service.runAutoRenew(july);
      expect(sessions.createSessions).toHaveBeenCalledTimes(1);
      const created = sessions.createSessions.mock.calls[0][0];
      // August 2026 Wednesdays: 5, 12, 19, 26 — still EDT (5pm = 21:00Z).
      expect(created.map((s: any) => s.start_datetime)).toEqual([
        '2026-08-05T21:00:00.000Z',
        '2026-08-12T21:00:00.000Z',
        '2026-08-19T21:00:00.000Z',
        '2026-08-26T21:00:00.000Z',
      ]);
      expect(created[0].end_datetime).toBe('2026-08-05T21:45:00.000Z'); // +45min
      expect(created[0]).toEqual(
        expect.objectContaining({
          type: 'GROUP',
          status: 'Pending',
          notes: '',
          series_id: 'series-1',
          tutor_id: 't-1',
          tutor_name: 'Tess',
          student_name: 'Ava, Ben',
          participants: [
            { id: 's-a', name: 'Ava' },
            { id: 's-b', name: 'Ben' },
          ],
        }),
      );
      expect(result.sessionsCreated).toBe(4);
    });

    it('keeps the Eastern wall time across the November DST transition', async () => {
      // Ascending order — the latest-pick comparator sees both orderings
      // across this test and the roster test above.
      sessions.getAllSessions.mockResolvedValue([
        groupSession({
          id: 'g-0',
          start_datetime: '2026-10-21T21:00:00.000Z',
        }),
        groupSession({ start_datetime: '2026-10-28T21:00:00.000Z' }), // Wed, 5pm EDT
      ]);
      // The October run rolls October's pending sessions into November.
      await service.runAutoRenew(new Date(2026, 9, 1));
      const created = sessions.createSessions.mock.calls[0][0];
      // November 2026 Wednesdays: 4, 11, 18, 25 — EST now, 5pm = 22:00Z.
      expect(created[0].start_datetime).toBe('2026-11-04T22:00:00.000Z');
      expect(created).toHaveLength(4);
    });

    it('rolls December into January of the next year', async () => {
      sessions.getAllSessions.mockResolvedValue([
        groupSession({ start_datetime: '2026-12-30T22:00:00.000Z' }), // Wed, 5pm EST
      ]);
      await service.runAutoRenew(new Date(2026, 11, 1));
      const created = sessions.createSessions.mock.calls[0][0];
      // January 2027 Wednesdays: 6, 13, 20, 27.
      expect(created.map((s: any) => s.start_datetime)).toEqual([
        '2027-01-06T22:00:00.000Z',
        '2027-01-13T22:00:00.000Z',
        '2027-01-20T22:00:00.000Z',
        '2027-01-27T22:00:00.000Z',
      ]);
    });

    it('skips a series that already has next-month sessions', async () => {
      sessions.getAllSessions.mockResolvedValue([
        groupSession(),
        groupSession({
          id: 'g-2',
          start_datetime: '2026-08-05T21:00:00.000Z',
        }),
      ]);
      await service.runAutoRenew(july);
      expect(sessions.createSessions).not.toHaveBeenCalled();
    });

    it('does not roll a cancelled series (no pending occurrences left)', async () => {
      sessions.getAllSessions.mockResolvedValue([
        groupSession({ status: 'Completed' }),
        groupSession({ id: 'g-2', status: 'Cancelled' }),
      ]);
      await service.runAutoRenew(july);
      expect(sessions.createSessions).not.toHaveBeenCalled();
    });

    it('ignores non-group sessions in the window', async () => {
      sessions.getAllSessions.mockResolvedValue([
        groupSession({ type: 'TUTORING' }),
      ]);
      await service.runAutoRenew(july);
      expect(sessions.createSessions).not.toHaveBeenCalled();
    });

    it('queries one Eastern-bounded two-month window', async () => {
      await service.runAutoRenew(july);
      expect(sessions.getAllSessions).toHaveBeenCalledWith({
        from: '2026-07-01T04:00:00.000Z', // Jul 1 midnight EDT
        to: '2026-09-01T04:00:00.000Z', // Sep 1 midnight EDT
      });
    });
  });
});
