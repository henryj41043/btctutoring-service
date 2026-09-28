import { SessionHorizonService } from './session-horizon.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { Session, SessionType } from '../models/session.model';

describe('SessionHorizonService', () => {
  let service: SessionHorizonService;
  const students = { getStudents: jest.fn(), getStudent: jest.fn() };
  const sessions = {
    createSessions: jest.fn(),
    getAllSessions: jest.fn(),
    getSessionsByStudent: jest.fn(),
  };
  const contacts = { getContacts: jest.fn() };
  const billing = { acquireLock: jest.fn(), releaseLock: jest.fn() };

  const student = (over: Partial<Student> = {}): Student =>
    ({
      id: 's-1',
      contact_id: 'c-1',
      name: 'Pat',
      status: 'Active Student',
      assigned_tutor_id: 't-1',
      package: 'Succeed',
      auto_renew: true,
      package_start_date: '2026-05-01T00:00:00',
      schedule: [
        { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:30' },
      ],
      ...over,
    }) as Student;
  const tutor = (): Contact => ({ id: 't-1', first_name: 'Tess' }) as Contact;
  const tutoring = (over: Partial<Session> = {}): Session =>
    ({
      id: 'x-1',
      type: 'TUTORING',
      status: 'Pending',
      student_id: 's-1',
      tutor_id: 't-1',
      series_id: 'ser-1',
      start_datetime: '2026-09-14T14:00:00.000Z',
      end_datetime: '2026-09-14T14:30:00.000Z',
      ...over,
    }) as Session;
  const group = (over: Partial<Session> = {}): Session =>
    ({
      id: 'g-1',
      type: 'GROUP',
      status: 'Pending',
      tutor_id: 't-1',
      tutor_name: 'Tess',
      student_name: 'BTC & Me',
      series_id: 'grp-1',
      participants: [{ id: 's-1', name: 'Pat' }],
      start_datetime: '2026-09-02T21:00:00.000Z', // Wed 5pm EDT
      end_datetime: '2026-09-02T21:45:00.000Z',
      ...over,
    }) as Session;

  // Sep 14 2026 → fills Oct, Nov, Dec.
  // Oct: Mon 5,12,19,26 + Wed 7,14,21,28 = 8; Nov: Mon 2,9,16,23,30 + Wed 4,11,18,25 = 9;
  // Dec: Mon 7,14,21,28 + Wed 2,9,16,23,30 = 9 → 26.
  const serviceEnd = { applyServiceEnds: jest.fn() };
  const promotion = { promoteDueChanges: jest.fn() };
  const now = new Date(2026, 8, 14, 7, 0, 0);
  const allCreated = (): Session[] =>
    sessions.createSessions.mock.calls.flatMap((c) => c[0] as Session[]);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    service = new SessionHorizonService(
      students as any,
      sessions as any,
      contacts as any,
      billing as any,
      serviceEnd as any,
      promotion as any,
    );
    promotion.promoteDueChanges.mockResolvedValue({ studentsPromoted: 0 });
    serviceEnd.applyServiceEnds.mockResolvedValue({
      studentsEnded: 0,
      sessionsDeleted: 0,
    });
    billing.acquireLock.mockResolvedValue(true);
    billing.releaseLock.mockResolvedValue(undefined);
    sessions.createSessions.mockResolvedValue({});
    sessions.getAllSessions.mockResolvedValue([]);
    sessions.getSessionsByStudent.mockResolvedValue([]);
    students.getStudents.mockResolvedValue([student()]);
    students.getStudent.mockResolvedValue([student()]);
    contacts.getContacts.mockResolvedValue([tutor()]);
  });

  it('fills the next three months (never the current one) for an eligible student', async () => {
    const result = await service.fillHorizon(now);
    expect(result).toEqual({
      studentsFilled: 1,
      sessionsCreated: 26,
      groupSessionsCreated: 0,
      monthsSkippedNoSchedule: 0,
      lockedOut: false,
    });
    expect(sessions.createSessions).toHaveBeenCalledTimes(3);
    const created = allCreated();
    expect(
      created.every((s) => s.start_datetime >= '2026-10-01T04:00:00.000Z'),
    ).toBe(true);
    expect(created.every((s) => s.start_datetime < '2027-01-01')).toBe(true);
    expect(created[0]).toMatchObject({
      type: 'TUTORING',
      status: 'Pending',
      student_id: 's-1',
      tutor_name: 'Tess',
      start_datetime: '2026-10-05T14:00:00.000Z',
    });
    // November is EST: 10:00 → 15:00Z.
    expect(
      created.find((s) => s.start_datetime.startsWith('2026-11-02'))
        ?.start_datetime,
    ).toBe('2026-11-02T15:00:00.000Z');
  });

  it('queries one Eastern-bounded window covering the current month + 3', async () => {
    await service.fillHorizon(now);
    expect(sessions.getAllSessions).toHaveBeenCalledWith({
      from: '2026-09-01T04:00:00.000Z',
      to: '2027-01-01T05:00:00.000Z',
    });
    expect(sessions.getAllSessions).toHaveBeenCalledTimes(1);
    expect(sessions.getSessionsByStudent).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { status: 'Past Student' }],
    ['auto-renew off', { auto_renew: false }],
    ['no schedule', { schedule: [] }],
    ['no start date', { package_start_date: undefined }],
  ])('skips a student that is %s', async (_label, over) => {
    students.getStudents.mockResolvedValue([student(over as Partial<Student>)]);
    const result = await service.fillHorizon(now);
    expect(sessions.createSessions).not.toHaveBeenCalled();
    expect(result.studentsFilled).toBe(0);
  });

  it('leaves a month alone when it already has any tutoring session (even cancelled)', async () => {
    sessions.getAllSessions.mockResolvedValue([
      tutoring({
        status: 'Cancelled',
        start_datetime: '2026-10-05T14:00:00.000Z',
      }),
    ]);
    const result = await service.fillHorizon(now);
    expect(result.sessionsCreated).toBe(18); // Nov + Dec only
    expect(allCreated().every((s) => s.start_datetime >= '2026-11-01')).toBe(
      true,
    );
  });

  it('does nothing when every horizon month is already filled', async () => {
    sessions.getAllSessions.mockResolvedValue([
      tutoring({ start_datetime: '2026-10-05T14:00:00.000Z' }),
      tutoring({ id: 'x-2', start_datetime: '2026-11-02T15:00:00.000Z' }),
      tutoring({ id: 'x-3', start_datetime: '2026-12-07T15:00:00.000Z' }),
    ]);
    const result = await service.fillHorizon(now);
    expect(sessions.createSessions).not.toHaveBeenCalled();
    expect(result.studentsFilled).toBe(0);
  });

  it('ignores sessions outside the window and of other types when bucketing', async () => {
    sessions.getAllSessions.mockResolvedValue([
      tutoring({ start_datetime: '2026-08-05T14:00:00.000Z' }), // before window
      tutoring({
        id: 'm-1',
        type: SessionType.MAKE_UP,
        start_datetime: '2026-10-05T14:00:00.000Z',
      }),
      tutoring({
        id: 'x-9',
        student_id: undefined,
        start_datetime: '2026-10-06T14:00:00.000Z',
      }),
    ]);
    const result = await service.fillHorizon(now);
    expect(result.sessionsCreated).toBe(26);
  });

  it('continues an existing series per tutor across the months it fills', async () => {
    sessions.getAllSessions.mockResolvedValue([
      tutoring({
        series_id: 'old',
        start_datetime: '2026-09-02T14:00:00.000Z',
      }),
      tutoring({
        id: 'x-2',
        series_id: 'ser-latest',
        start_datetime: '2026-09-09T14:00:00.000Z',
      }),
    ]);
    await service.fillHorizon(now);
    const created = allCreated();
    expect(created).toHaveLength(26);
    expect(created.every((s) => s.series_id === 'ser-latest')).toBe(true);
  });

  it('chains a freshly minted series through the later months', async () => {
    await service.fillHorizon(now);
    const created = allCreated();
    expect(new Set(created.map((s) => s.series_id)).size).toBe(1);
  });

  describe('scheduled package changes', () => {
    const friday = [
      { weekday: 'FRIDAY', start_time: '09:00', end_time: '10:00' },
    ];

    it("generates a change's months from its own schedule", async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-11-01', schedule: friday },
          ],
        }),
      ]);
      const result = await service.fillHorizon(now);
      // Oct from the current schedule (8) + Nov Fridays 6,13,20,27 (4) + Dec Fridays 4,11,18,25 (4).
      expect(result.sessionsCreated).toBe(16);
      const nov = allCreated().filter((s) =>
        s.start_datetime.startsWith('2026-11'),
      );
      expect(nov).toHaveLength(4);
      expect(nov[0].start_datetime).toBe('2026-11-06T14:00:00.000Z'); // 09:00 EST
    });

    it('leaves the months of a change without a schedule empty and counts them', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [{ package: 'Excel', effective: '2026-11-01' }],
        }),
      ]);
      const result = await service.fillHorizon(now);
      expect(result.sessionsCreated).toBe(8); // October only
      expect(result.monthsSkippedNoSchedule).toBe(2);
      expect(result.studentsFilled).toBe(1);
    });

    it('lets a later change with a schedule take over after an earlier one without', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-11-01' },
            { package: 'Achieve', effective: '2026-12-01', schedule: friday },
          ],
        }),
      ]);
      const result = await service.fillHorizon(now);
      expect(result.sessionsCreated).toBe(12); // Oct 8 + Dec Fridays 4
      expect(result.monthsSkippedNoSchedule).toBe(1);
    });
  });

  describe('package start date', () => {
    it('starts a future start month on the start date and skips earlier months', async () => {
      students.getStudents.mockResolvedValue([
        student({ package_start_date: '2026-11-10T00:00:00' }),
      ]);
      const result = await service.fillHorizon(now);
      // Nov from the 10th: Mon 16,23,30 + Wed 11,18,25 = 6; Dec 9.
      expect(result.sessionsCreated).toBe(15);
      const created = allCreated();
      expect(created.every((s) => s.start_datetime >= '2026-11-10')).toBe(true);
    });

    it('does not count a student whose months all precede... nothing to create', async () => {
      students.getStudents.mockResolvedValue([
        student({ package_start_date: '2027-02-01T00:00:00' }),
      ]);
      const result = await service.fillHorizon(now);
      expect(sessions.createSessions).not.toHaveBeenCalled();
      expect(result.studentsFilled).toBe(0);
    });
  });

  describe('lock', () => {
    it('runs without touching the lock by default', async () => {
      await service.fillHorizon(now);
      expect(billing.acquireLock).not.toHaveBeenCalled();
      expect(billing.releaseLock).not.toHaveBeenCalled();
    });

    it("takes the per-day lock and releases yesterday's afterwards", async () => {
      const result = await service.fillHorizon(now, { lock: true });
      expect(billing.acquireLock).toHaveBeenCalledWith(
        'lock#horizon#2026-09-14',
      );
      expect(billing.releaseLock).toHaveBeenCalledWith(
        'lock#horizon#2026-09-13',
      );
      expect(result.lockedOut).toBe(false);
      expect(result.sessionsCreated).toBe(26);
    });

    it('is locked out when the day lock is already held', async () => {
      billing.acquireLock.mockResolvedValue(false);
      const result = await service.fillHorizon(now, { lock: true });
      expect(result.lockedOut).toBe(true);
      expect(result.sessionsCreated).toBe(0);
      expect(students.getStudents).not.toHaveBeenCalled();
      expect(billing.releaseLock).not.toHaveBeenCalled();
    });

    it('handleDaily runs a locked fill for now', async () => {
      const spy = jest
        .spyOn(service, 'fillHorizon')
        .mockResolvedValue({} as never);
      await service.handleDaily();
      expect(spy).toHaveBeenCalledWith(expect.any(Date), { lock: true });
    });
  });

  describe('single-student fill', () => {
    it('reads only that student and their sessions, and skips the group roll', async () => {
      sessions.getSessionsByStudent.mockResolvedValue([]);
      sessions.getAllSessions.mockResolvedValue([group()]);
      const result = await service.fillHorizon(now, { studentId: 's-1' });
      expect(students.getStudent).toHaveBeenCalledWith('s-1');
      expect(students.getStudents).not.toHaveBeenCalled();
      expect(sessions.getSessionsByStudent).toHaveBeenCalledWith('s-1', {
        from: '2026-09-01T04:00:00.000Z',
        to: '2027-01-01T05:00:00.000Z',
      });
      expect(sessions.getAllSessions).not.toHaveBeenCalled();
      expect(result.sessionsCreated).toBe(26);
      expect(result.groupSessionsCreated).toBe(0);
    });

    it('reports nothing for an unknown student', async () => {
      students.getStudent.mockResolvedValue([]);
      const result = await service.fillHorizon(now, { studentId: 'nope' });
      expect(result.studentsFilled).toBe(0);
    });
  });

  describe('group series roll', () => {
    it('rolls a running series month by month through the horizon', async () => {
      students.getStudents.mockResolvedValue([]);
      sessions.getAllSessions.mockResolvedValue([group()]);
      const result = await service.fillHorizon(now);
      // Oct Wed 7,14,21,28 (4) + Nov 4,11,18,25 (4) + Dec 2,9,16,23,30 (5) = 13
      expect(result.groupSessionsCreated).toBe(13);
      expect(sessions.createSessions).toHaveBeenCalledTimes(3);
      const created = allCreated();
      expect(created[0]).toMatchObject({
        type: 'GROUP',
        series_id: 'grp-1',
        start_datetime: '2026-10-07T21:00:00.000Z',
        participants: [{ id: 's-1', name: 'Pat' }],
      });
      // Wall time carried across the DST switch.
      expect(
        created.find((s) => s.start_datetime.startsWith('2026-11-04'))
          ?.start_datetime,
      ).toBe('2026-11-04T22:00:00.000Z');
    });

    it('does not roll a series with no pending occurrence left', async () => {
      students.getStudents.mockResolvedValue([]);
      sessions.getAllSessions.mockResolvedValue([
        group({ status: 'Cancelled' }),
      ]);
      const result = await service.fillHorizon(now);
      expect(result.groupSessionsCreated).toBe(0);
    });

    it('skips a month a series already has and continues from it', async () => {
      students.getStudents.mockResolvedValue([]);
      sessions.getAllSessions.mockResolvedValue([
        group(),
        group({ id: 'g-2', start_datetime: '2026-10-07T21:00:00.000Z' }),
      ]);
      const result = await service.fillHorizon(now);
      expect(result.groupSessionsCreated).toBe(9); // Nov 4 + Dec 5
      expect(allCreated().every((s) => s.start_datetime >= '2026-11-01')).toBe(
        true,
      );
    });

    it('ignores group sessions without a series id', async () => {
      students.getStudents.mockResolvedValue([]);
      sessions.getAllSessions.mockResolvedValue([
        group({ series_id: undefined }),
      ]);
      const result = await service.fillHorizon(now);
      expect(result.groupSessionsCreated).toBe(0);
    });
  });

  it("keeps going when one student's write fails", async () => {
    students.getStudents.mockResolvedValue([student(), student({ id: 's-2' })]);
    sessions.createSessions
      .mockRejectedValueOnce(new Error('dynamo down'))
      .mockResolvedValue({});
    const result = await service.fillHorizon(now);
    expect(result.studentsFilled).toBe(1);
    expect(result.sessionsCreated).toBe(26);
  });

  describe('service end date', () => {
    it('applies service ends before the locked daily fill, never on manual fills', async () => {
      await service.fillHorizon(now, { lock: true });
      expect(serviceEnd.applyServiceEnds).toHaveBeenCalledWith(now);
      expect(
        serviceEnd.applyServiceEnds.mock.invocationCallOrder[0],
      ).toBeLessThan(students.getStudents.mock.invocationCallOrder[0]);
      serviceEnd.applyServiceEnds.mockClear();
      await service.fillHorizon(now, { lock: false });
      await service.fillHorizon(now, { studentId: 's-1' });
      expect(serviceEnd.applyServiceEnds).not.toHaveBeenCalled();
    });

    it('skips service ends when the day is locked out', async () => {
      billing.acquireLock.mockResolvedValue(false);
      await service.fillHorizon(now, { lock: true });
      expect(serviceEnd.applyServiceEnds).not.toHaveBeenCalled();
    });

    it('a service-end failure never blocks the fill', async () => {
      serviceEnd.applyServiceEnds.mockRejectedValue(new Error('boom'));
      const res = await service.fillHorizon(now, { lock: true });
      expect(res.sessionsCreated).toBe(26);
    });

    it('stops generating at the end date', async () => {
      // Ends Wed Nov 11: Oct 8 + Nov (Mon 2, 9 + Wed 4, 11) 4 = 12; no Dec.
      students.getStudents.mockResolvedValue([
        student({ service_end_date: '2026-11-11' }),
      ]);
      const res = await service.fillHorizon(now);
      expect(res.sessionsCreated).toBe(12);
      const starts = allCreated().map((s) => s.start_datetime);
      expect(starts.every((iso) => iso < '2026-11-12T05:00:00.000Z')).toBe(
        true,
      );
      expect(starts.some((iso) => iso.startsWith('2026-11-11'))).toBe(true);
    });

    it('an end date on the last day of a month keeps that month whole', async () => {
      students.getStudents.mockResolvedValue([
        student({ service_end_date: '2026-10-31' }),
      ]);
      const res = await service.fillHorizon(now);
      expect(res.sessionsCreated).toBe(8);
    });

    it('an end date in the current month generates nothing ahead', async () => {
      students.getStudents.mockResolvedValue([
        student({ service_end_date: '2026-09-30' }),
      ]);
      const res = await service.fillHorizon(now);
      expect(res.sessionsCreated).toBe(0);
      expect(res.studentsFilled).toBe(0);
    });
  });

  describe('package changes on any date', () => {
    const friday = [
      { weekday: 'FRIDAY', start_time: '09:00', end_time: '09:30' },
    ];
    const days = (): string[] =>
      allCreated()
        .map((s) => s.start_datetime.slice(0, 10))
        .sort();

    it('promotes due changes before service ends and the fill, only on the locked run', async () => {
      await service.fillHorizon(now, { lock: true });
      expect(promotion.promoteDueChanges).toHaveBeenCalledWith(now);
      expect(
        promotion.promoteDueChanges.mock.invocationCallOrder[0],
      ).toBeLessThan(serviceEnd.applyServiceEnds.mock.invocationCallOrder[0]);
      promotion.promoteDueChanges.mockClear();
      await service.fillHorizon(now, { lock: false });
      await service.fillHorizon(now, { studentId: 's-1' });
      expect(promotion.promoteDueChanges).not.toHaveBeenCalled();
    });

    it('a promotion failure never blocks the fill', async () => {
      promotion.promoteDueChanges.mockRejectedValue(new Error('boom'));
      const res = await service.fillHorizon(now, { lock: true });
      expect(serviceEnd.applyServiceEnds).toHaveBeenCalled();
      expect(res.sessionsCreated).toBe(26);
    });

    it('switches the slots on the change date inside a month', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', schedule: friday },
          ],
        }),
      ]);
      await service.fillHorizon(now);
      const october = days().filter((d) => d.startsWith('2026-10'));
      // Old slots to Oct 13 (Mon 5, 12 + Wed 7); Fridays from Oct 14.
      expect(october).toEqual([
        '2026-10-05',
        '2026-10-07',
        '2026-10-12',
        '2026-10-16',
        '2026-10-23',
        '2026-10-30',
      ]);
      // November and December are all Fridays: 4 + 4.
      expect(days().filter((d) => d > '2026-10-31')).toHaveLength(8);
    });

    it('fills each stretch on its own: one already generated, the other not', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', schedule: friday },
          ],
        }),
      ]);
      // The first half of October exists; the admin just reset the stretch
      // from the change date (pending-schedule save).
      sessions.getAllSessions.mockResolvedValue([
        tutoring({ start_datetime: '2026-10-05T14:00:00.000Z' }),
      ]);
      await service.fillHorizon(now);
      expect(days().filter((d) => d.startsWith('2026-10'))).toEqual([
        '2026-10-16',
        '2026-10-23',
        '2026-10-30',
      ]);
    });

    it('reads a session by its Eastern date', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', schedule: friday },
          ],
        }),
      ]);
      // 01:00 UTC on Oct 14 is 9pm on Oct 13 in New York: the OLD stretch.
      sessions.getAllSessions.mockResolvedValue([
        tutoring({ start_datetime: '2026-10-14T01:00:00.000Z' }),
      ]);
      await service.fillHorizon(now);
      expect(days().filter((d) => d.startsWith('2026-10'))).toEqual([
        '2026-10-16',
        '2026-10-23',
        '2026-10-30',
      ]);
    });

    it('a change without a schedule leaves its stretch empty and is counted', async () => {
      students.getStudents.mockResolvedValue([
        student({
          pending_changes: [{ package: 'Excel', effective: '2026-10-14' }],
        }),
      ]);
      const res = await service.fillHorizon(now);
      expect(days()).toEqual(['2026-10-05', '2026-10-07', '2026-10-12']);
      // The rest of October, all of November and December.
      expect(res.monthsSkippedNoSchedule).toBe(3);
    });

    describe('current month', () => {
      it('never touches the running schedule', async () => {
        const res = await service.fillHorizon(now);
        expect(days().some((d) => d.startsWith('2026-09'))).toBe(false);
        expect(res.sessionsCreated).toBe(26);
      });

      it('fills a change landing later this month', async () => {
        students.getStudents.mockResolvedValue([
          student({
            pending_changes: [
              { package: 'Excel', effective: '2026-09-21', schedule: friday },
            ],
          }),
        ]);
        await service.fillHorizon(now);
        expect(days().filter((d) => d.startsWith('2026-09'))).toEqual([
          '2026-09-25',
        ]);
      });

      it('fills a stretch that starts today (a change promoted this morning)', async () => {
        students.getStudents.mockResolvedValue([
          student({ package_start_date: '2026-09-14T00:00:00' }),
        ]);
        await service.fillHorizon(now);
        // Mon 14, 21, 28 + Wed 16, 23, 30.
        expect(days().filter((d) => d.startsWith('2026-09'))).toHaveLength(6);
      });

      it('leaves a stretch that started yesterday alone', async () => {
        students.getStudents.mockResolvedValue([
          student({ package_start_date: '2026-09-13T00:00:00' }),
        ]);
        await service.fillHorizon(now);
        expect(days().some((d) => d.startsWith('2026-09'))).toBe(false);
      });

      it('skips a stretch the app already generated', async () => {
        students.getStudents.mockResolvedValue([
          student({ package_start_date: '2026-09-21T00:00:00' }),
        ]);
        sessions.getAllSessions.mockResolvedValue([
          tutoring({ start_datetime: '2026-09-23T14:00:00.000Z' }),
        ]);
        await service.fillHorizon(now);
        expect(days().some((d) => d.startsWith('2026-09'))).toBe(false);
      });
    });
  });

  describe('first-week sessions', () => {
    it('builds the one-off session with a future start month, once', async () => {
      const starter = student({
        package_start_date: '2026-10-09T00:00:00',
        first_week_sessions: [
          { date: '2026-10-10', start_time: '11:00', end_time: '11:30' },
        ],
      });
      students.getStudents.mockResolvedValue([starter]);
      await service.fillHorizon(now);
      const created = allCreated();
      const october = created.filter((s) =>
        s.start_datetime.startsWith('2026-10'),
      );
      // From Fri Oct 9: Mon 12, 19, 26 + Wed 14, 21, 28 = 6, plus Sat Oct 10.
      expect(october).toHaveLength(7);
      const oneOff = october.find((s) =>
        s.start_datetime.startsWith('2026-10-10'),
      )!;
      expect(oneOff.series_id).toBeUndefined();
      expect(created.filter((s) => !s.series_id)).toHaveLength(1);

      // A second run sees the stretch filled and adds nothing.
      sessions.createSessions.mockClear();
      sessions.getAllSessions.mockResolvedValue(
        created.map((s, i) => ({ ...s, id: `x-${i}` })),
      );
      const again = await service.fillHorizon(now);
      expect(again.sessionsCreated).toBe(0);
    });
  });

  describe('rebuild from a date', () => {
    const friday = [
      { weekday: 'FRIDAY', start_time: '09:00', end_time: '09:30' },
    ];
    const days = (): string[] =>
      allCreated()
        .map((s) => s.start_datetime.slice(0, 10))
        .sort();
    const rebuild = (from: string) =>
      service.fillHorizon(now, { studentId: 's-1', rebuildFrom: from });

    it('rebuilds the rest of the running schedule this month and the months ahead', async () => {
      const res = await rebuild('2026-09-21');
      // Sept from the 21st: Mon 21, 28 + Wed 23, 30.
      expect(days().filter((d) => d.startsWith('2026-09'))).toEqual([
        '2026-09-21',
        '2026-09-23',
        '2026-09-28',
        '2026-09-30',
      ]);
      expect(res.sessionsCreated).toBe(4 + 26);
      expect(res.studentsFilled).toBe(1);
      expect(sessions.getSessionsByStudent).toHaveBeenCalledWith(
        's-1',
        expect.anything(),
      );
    });

    it('never reaches into the past: an earlier date starts today, after now', async () => {
      // now = Mon Sept 14 07:00 local; the 10:00 Eastern session is 14:00Z.
      await rebuild('2026-09-01');
      const september = days().filter((d) => d.startsWith('2026-09'));
      expect(september[0]).toBe('2026-09-14');
      expect(september).toHaveLength(6);
    });

    it('drops a session that already started today', async () => {
      const late = new Date(2026, 8, 14, 23, 0, 0);
      await service.fillHorizon(late, {
        studentId: 's-1',
        rebuildFrom: '2026-09-14',
      });
      const created = allCreated().map((s) => s.start_datetime);
      expect(created.every((iso) => iso > late.toISOString())).toBe(true);
    });

    it('skips only the sessions that already exist at the same start time', async () => {
      students.getStudent.mockResolvedValue([student()]);
      sessions.getSessionsByStudent.mockResolvedValue([
        // A pre-cancelled vacation session must not block the rest.
        tutoring({
          status: 'Cancelled',
          start_datetime: '2026-09-21T14:00:00.000Z',
        }),
      ]);
      await rebuild('2026-09-21');
      expect(days().filter((d) => d.startsWith('2026-09'))).toEqual([
        '2026-09-23',
        '2026-09-28',
        '2026-09-30',
      ]);
    });

    it('is idempotent: a second rebuild creates nothing', async () => {
      await rebuild('2026-09-21');
      const first = allCreated().map((s, i) => ({ ...s, id: `x-${i}` }));
      sessions.createSessions.mockClear();
      sessions.getSessionsByStudent.mockResolvedValue(first);
      const again = await rebuild('2026-09-21');
      expect(again.sessionsCreated).toBe(0);
      expect(sessions.createSessions).not.toHaveBeenCalled();
    });

    it('follows the schedule that now applies to each stretch', async () => {
      students.getStudent.mockResolvedValue([
        student({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', schedule: friday },
          ],
        }),
      ]);
      await rebuild('2026-10-01');
      expect(days().some((d) => d.startsWith('2026-09'))).toBe(false);
      expect(days().filter((d) => d.startsWith('2026-10'))).toEqual([
        '2026-10-05',
        '2026-10-07',
        '2026-10-12',
        '2026-10-16',
        '2026-10-23',
        '2026-10-30',
      ]);
    });

    it('starts inside a stretch when the date falls in the middle of it', async () => {
      await rebuild('2026-10-20');
      // Mon 26 + Wed 21, 28.
      expect(days().filter((d) => d.startsWith('2026-10'))).toEqual([
        '2026-10-21',
        '2026-10-26',
        '2026-10-28',
      ]);
    });

    it('a change without a schedule leaves its stretch empty and is counted', async () => {
      students.getStudent.mockResolvedValue([
        student({
          pending_changes: [{ package: 'Excel', effective: '2026-10-14' }],
        }),
      ]);
      const res = await rebuild('2026-10-01');
      expect(days()).toEqual(['2026-10-05', '2026-10-07', '2026-10-12']);
      expect(res.monthsSkippedNoSchedule).toBe(3);
    });

    it('without auto-renew only this month is rebuilt', async () => {
      students.getStudent.mockResolvedValue([student({ auto_renew: false })]);
      const res = await rebuild('2026-09-21');
      expect(res.sessionsCreated).toBe(4);
      expect(days().every((d) => d.startsWith('2026-09'))).toBe(true);
    });

    it('still needs an Active student with a schedule', async () => {
      students.getStudent.mockResolvedValue([
        student({ status: 'Past Student' }),
      ]);
      expect((await rebuild('2026-09-21')).sessionsCreated).toBe(0);
      students.getStudent.mockResolvedValue([student({ schedule: [] })]);
      expect((await rebuild('2026-09-21')).sessionsCreated).toBe(0);
    });

    it('stops at the service end date', async () => {
      students.getStudent.mockResolvedValue([
        student({ service_end_date: '2026-09-24' }),
      ]);
      await rebuild('2026-09-21');
      expect(days()).toEqual(['2026-09-21', '2026-09-23']);
    });

    it('is ignored without a student: the whole-fleet fill keeps its cautious rule', async () => {
      const res = await service.fillHorizon(now, { rebuildFrom: '2026-09-21' });
      expect(days().some((d) => d.startsWith('2026-09'))).toBe(false);
      expect(res.sessionsCreated).toBe(26);
    });

    it('keeps a reused series going and never adopts a one-off as a series', async () => {
      students.getStudent.mockResolvedValue([student()]);
      sessions.getSessionsByStudent.mockResolvedValue([
        tutoring({ series_id: 'ser-keep' }),
      ]);
      await rebuild('2026-09-21');
      expect(allCreated().every((s) => s.series_id === 'ser-keep')).toBe(true);
    });
  });
});
