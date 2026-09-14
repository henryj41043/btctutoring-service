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
    );
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
});
