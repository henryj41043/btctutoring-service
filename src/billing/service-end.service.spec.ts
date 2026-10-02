import {
  dayAfterStartIso,
  easternDateKey,
  ServiceEndService,
} from './service-end.service';
import { Student } from '../models/student.model';
import { Session } from '../models/session.model';

describe('service end helpers', () => {
  it('easternDateKey reads the Eastern calendar date', () => {
    // 03:00 UTC on Sept 15 is still 11pm on Sept 14 in New York.
    expect(easternDateKey(new Date('2026-09-15T03:00:00Z'))).toBe('2026-09-14');
    expect(easternDateKey(new Date('2026-09-15T04:00:00Z'))).toBe('2026-09-15');
    expect(easternDateKey(new Date('2026-01-01T04:59:59Z'))).toBe('2025-12-31');
    expect(easternDateKey(new Date('2026-01-01T05:00:00Z'))).toBe('2026-01-01');
  });

  it('dayAfterStartIso is Eastern midnight of the next day', () => {
    expect(dayAfterStartIso('2026-09-14')).toBe('2026-09-15T04:00:00.000Z');
    expect(dayAfterStartIso('2026-09-30')).toBe('2026-10-01T04:00:00.000Z');
    expect(dayAfterStartIso('2026-12-31')).toBe('2027-01-01T05:00:00.000Z');
    // The clocks fall back on Nov 1 2026: Nov 2 starts in EST.
    expect(dayAfterStartIso('2026-11-01')).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('ServiceEndService', () => {
  let service: ServiceEndService;
  const students = { getStudents: jest.fn(), applyServiceEnd: jest.fn() };
  const sessions = {
    getSessionsByStudent: jest.fn(),
    deleteSession: jest.fn(),
  };

  const student = (over: Partial<Student> = {}): Student =>
    ({
      id: 's-1',
      contact_id: 'c-1',
      name: 'Pat',
      status: 'Active Student',
      service_end_date: '2026-09-13',
      ...over,
    }) as Student;
  const session = (over: Partial<Session> = {}): Session =>
    ({
      id: 'x-1',
      type: 'TUTORING',
      status: 'Pending',
      student_id: 's-1',
      start_datetime: '2026-09-16T14:00:00.000Z',
      ...over,
    }) as Session;

  // 07:00 UTC Sept 14 2026 = 3am Eastern on the 14th.
  const now = new Date('2026-09-14T07:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    service = new ServiceEndService(students as any, sessions as any);
    students.getStudents.mockResolvedValue([student()]);
    students.applyServiceEnd.mockResolvedValue('Past Student');
    sessions.getSessionsByStudent.mockResolvedValue([]);
    sessions.deleteSession.mockResolvedValue({});
  });

  it('ends a student the first morning after their last day', async () => {
    const res = await service.applyServiceEnds(now);
    expect(students.applyServiceEnd).toHaveBeenCalledWith(student());
    expect(res).toEqual({ studentsEnded: 1, sessionsDeleted: 0 });
  });

  it('leaves a student Active on their last day of service', async () => {
    students.getStudents.mockResolvedValue([
      student({ service_end_date: '2026-09-14' }),
    ]);
    const res = await service.applyServiceEnds(now);
    expect(students.applyServiceEnd).not.toHaveBeenCalled();
    expect(res.studentsEnded).toBe(0);
  });

  it('uses the Eastern date, not the UTC one', async () => {
    students.getStudents.mockResolvedValue([
      student({ service_end_date: '2026-09-14' }),
    ]);
    // 03:00 UTC on the 15th is still the 14th in New York.
    await service.applyServiceEnds(new Date('2026-09-15T03:00:00Z'));
    expect(students.applyServiceEnd).not.toHaveBeenCalled();
    await service.applyServiceEnds(new Date('2026-09-15T04:00:00Z'));
    expect(students.applyServiceEnd).toHaveBeenCalledTimes(1);
  });

  it('catches up after missed runs', async () => {
    students.getStudents.mockResolvedValue([
      student({ service_end_date: '2026-08-01T00:00:00' }),
    ]);
    const res = await service.applyServiceEnds(now);
    expect(res.studentsEnded).toBe(1);
  });

  it('never re-ends a student who already left Active', async () => {
    students.getStudents.mockResolvedValue([
      student({ status: 'Past Student' }),
      student({ id: 's-2', status: 'MIA' }),
    ]);
    const res = await service.applyServiceEnds(now);
    expect(students.applyServiceEnd).not.toHaveBeenCalled();
    expect(res.studentsEnded).toBe(0);
  });

  it('ignores students without an end date or an id', async () => {
    students.getStudents.mockResolvedValue([
      student({ service_end_date: undefined }),
      student({ service_end_date: null }),
      student({ service_end_date: 'soon' }),
      student({ id: undefined }),
    ]);
    const res = await service.applyServiceEnds(now);
    expect(sessions.getSessionsByStudent).not.toHaveBeenCalled();
    expect(students.applyServiceEnd).not.toHaveBeenCalled();
    expect(res).toEqual({ studentsEnded: 0, sessionsDeleted: 0 });
  });

  it('removes only pending tutoring sessions and custom trials after the end date', async () => {
    students.getStudents.mockResolvedValue([
      student({ service_end_date: '2026-10-15' }),
    ]);
    sessions.getSessionsByStudent.mockResolvedValue([
      session({ id: 'a' }),
      session({ id: 'b' }),
      session({ id: 'held', status: 'Completed' }),
      session({ id: 'cancelled', status: 'Cancelled' }),
      session({ id: 'makeup', type: 'MAKE_UP' as never }),
      session({ id: 'group', type: 'GROUP' as never }),
      session({ id: 'trial', type: 'TRIAL' as never }),
      session({ id: 'custom', type: 'CUSTOM_TRIAL' as never }),
      session({
        id: 'custom-held',
        type: 'CUSTOM_TRIAL' as never,
        status: 'Completed',
      }),
      session({ id: undefined }),
    ]);
    const res = await service.applyServiceEnds(now);
    expect(sessions.getSessionsByStudent).toHaveBeenCalledWith('s-1', {
      from: '2026-10-16T04:00:00.000Z',
    });
    expect(sessions.deleteSession.mock.calls.map((c) => c[0])).toEqual([
      'a',
      'b',
      'custom',
    ]);
    // A future end date cleans up but leaves the student Active.
    expect(students.applyServiceEnd).not.toHaveBeenCalled();
    expect(res).toEqual({ studentsEnded: 0, sessionsDeleted: 3 });
  });

  it('cleans up for a student who already left Active too', async () => {
    students.getStudents.mockResolvedValue([
      student({ status: 'Past Student' }),
    ]);
    sessions.getSessionsByStudent.mockResolvedValue([session()]);
    const res = await service.applyServiceEnds(now);
    expect(res).toEqual({ studentsEnded: 0, sessionsDeleted: 1 });
  });

  it('one student failing never stops the others', async () => {
    students.getStudents.mockResolvedValue([
      student({ id: 's-1' }),
      student({ id: 's-2' }),
      student({ id: 's-3' }),
    ]);
    sessions.getSessionsByStudent
      .mockRejectedValueOnce(new Error('scan boom'))
      .mockResolvedValue([]);
    students.applyServiceEnd
      .mockRejectedValueOnce(new Error('update boom'))
      .mockResolvedValue('Past Student');
    const res = await service.applyServiceEnds(now);
    expect(sessions.getSessionsByStudent).toHaveBeenCalledTimes(3);
    expect(students.applyServiceEnd).toHaveBeenCalledTimes(2);
    expect(res.studentsEnded).toBe(1);
  });

  it('rejects when the students cannot be loaded', async () => {
    students.getStudents.mockRejectedValue(new Error('down'));
    await expect(service.applyServiceEnds(now)).rejects.toThrow('down');
  });
});
