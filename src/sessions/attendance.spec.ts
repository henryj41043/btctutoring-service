import { Session, SessionType } from '../models/session.model';
import { Student } from '../models/student.model';
import {
  ATTENDANCE_FINAL_MESSAGE,
  attendanceEffect,
  isFinalized,
  lockedFieldChanges,
  planAttendanceChange,
  SESSION_STATUS,
  SESSION_STATUSES,
  sessionMinutes,
} from './attendance';

const NOW = new Date('2026-09-28T16:00:00.000Z');
const START = '2026-09-21T14:00:00.000Z';
const session = (over: Partial<Session> = {}): Session =>
  ({
    id: 'x-1',
    type: SessionType.TUTORING,
    start_datetime: START,
    end_datetime: '2026-09-21T15:00:00.000Z',
    status: 'Pending',
    notes: '',
    student_id: 's-1',
    tutor_id: 't-1',
    tutor_name: 'Tess',
    ...over,
  }) as Session;
const student = (over: Partial<Student> = {}): Student =>
  ({
    id: 's-1',
    name: 'Pat',
    make_up_minutes: 120,
    make_up_batches: [
      { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
    ],
    ...over,
  }) as Student;

describe('attendance rules', () => {
  it('names the statuses as the app stores them', () => {
    expect(SESSION_STATUS).toEqual({
      PENDING: 'Pending',
      COMPLETED: 'Completed',
      CANCELLED: 'Cancelled',
      NO_CALL_NO_SHOW: 'NCNS',
    });
    expect(SESSION_STATUSES).toEqual([
      'Pending',
      'Completed',
      'Cancelled',
      'NCNS',
    ]);
    expect(ATTENDANCE_FINAL_MESSAGE).toBe(
      'Attendance is final. Ask an admin to correct it.',
    );
  });

  it('a session is final once it leaves Pending', () => {
    expect(isFinalized('Pending')).toBe(false);
    expect(isFinalized(undefined)).toBe(false);
    expect(isFinalized('')).toBe(false);
    for (const status of ['Completed', 'Cancelled', 'NCNS']) {
      expect(isFinalized(status)).toBe(true);
    }
  });

  it.each([
    [SessionType.TUTORING, 'Cancelled', 'bank'],
    [SessionType.TUTORING, 'Completed', null],
    [SessionType.TUTORING, 'NCNS', null],
    [SessionType.TUTORING, 'Pending', null],
    [SessionType.MAKE_UP, 'Completed', 'consume'],
    [SessionType.MAKE_UP, 'NCNS', 'consume'],
    [SessionType.MAKE_UP, 'Cancelled', null],
    [SessionType.MAKE_UP, 'Pending', null],
    [SessionType.TRIAL, 'Cancelled', null],
    [SessionType.TRIAL, 'Completed', null],
    [SessionType.GROUP, 'Cancelled', null],
    [SessionType.GROUP, 'Completed', null],
    [SessionType.ADMIN, 'Cancelled', null],
    [undefined, 'Cancelled', null],
  ])('%s marked %s → %s', (type, status, effect) => {
    expect(attendanceEffect(type, status)).toBe(effect);
  });

  it('measures a session in minutes', () => {
    expect(sessionMinutes(session())).toBe(60);
    expect(
      sessionMinutes(session({ end_datetime: '2026-09-21T14:45:00.000Z' })),
    ).toBe(45);
    expect(sessionMinutes(session({ end_datetime: START }))).toBe(0);
    expect(
      sessionMinutes(session({ end_datetime: '2026-09-21T13:00:00.000Z' })),
    ).toBe(0);
    expect(sessionMinutes(session({ end_datetime: 'nope' }))).toBe(0);
    expect(sessionMinutes(session({ start_datetime: 'nope' }))).toBe(0);
  });

  describe('planAttendanceChange', () => {
    const plan = (
      s: Partial<Session>,
      to: string,
      st: Student | undefined = student(),
    ) => planAttendanceChange(session(s), to, st, NOW);

    describe('first attendance', () => {
      it('a cancelled tutoring session banks its length at the session date', () => {
        const p = plan({}, 'Cancelled');
        expect(p).toEqual(
          expect.objectContaining({
            before: 120,
            after: 180,
            delta: 60,
            unrecovered: 0,
          }),
        );
        expect(p.student!.make_up_batches).toEqual([
          { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
          { minutes: 60, earned_date: START },
        ]);
      });

      it.each(['Completed', 'NCNS'])(
        'a tutoring session marked %s moves nothing',
        (to) => {
          const p = plan({}, to);
          expect(p).toEqual({
            before: 120,
            after: 120,
            delta: 0,
            unrecovered: 0,
          });
          expect(p.student).toBeUndefined();
        },
      );

      it.each(['Completed', 'NCNS'])(
        'a make-up marked %s consumes its length',
        (to) => {
          expect(plan({ type: SessionType.MAKE_UP }, to)).toEqual(
            expect.objectContaining({
              before: 120,
              after: 60,
              delta: -60,
              unrecovered: 0,
            }),
          );
        },
      );

      it('a cancelled make-up moves nothing', () => {
        expect(plan({ type: SessionType.MAKE_UP }, 'Cancelled').delta).toBe(0);
      });

      it('a make-up longer than the balance reports the shortfall', () => {
        expect(
          plan(
            { type: SessionType.MAKE_UP },
            'Completed',
            student({ make_up_batches: [{ minutes: 20, earned_date: START }] }),
          ),
        ).toEqual(
          expect.objectContaining({
            before: 20,
            after: 0,
            delta: -20,
            unrecovered: 40,
          }),
        );
      });

      it.each([SessionType.TRIAL, SessionType.GROUP, SessionType.ADMIN])(
        'a %s session never moves minutes',
        (type) => {
          for (const to of ['Completed', 'Cancelled', 'NCNS']) {
            expect(plan({ type }, to).delta).toBe(0);
          }
        },
      );
    });

    describe('correcting attendance', () => {
      const banked = () =>
        student({
          make_up_batches: [
            { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
            { minutes: 60, earned_date: START },
          ],
        });

      it.each(['Completed', 'NCNS', 'Pending'])(
        'tutoring Cancelled → %s takes the banked minutes back',
        (to) => {
          const p = plan({ status: 'Cancelled' }, to, banked());
          expect(p).toEqual(
            expect.objectContaining({
              before: 180,
              after: 120,
              delta: -60,
              unrecovered: 0,
            }),
          );
          expect(p.student!.make_up_batches).toEqual([
            { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
          ]);
        },
      );

      it('minutes already used come out of the other minutes', () => {
        const p = plan(
          { status: 'Cancelled' },
          'Completed',
          student({
            make_up_batches: [
              { minutes: 100, earned_date: '2026-09-01T14:00:00.000Z' },
            ],
          }),
        );
        expect(p).toEqual(
          expect.objectContaining({
            before: 100,
            after: 40,
            delta: -60,
            unrecovered: 0,
          }),
        );
      });

      it('reports what could not be taken back', () => {
        const p = plan(
          { status: 'Cancelled' },
          'Completed',
          student({
            make_up_batches: [
              { minutes: 25, earned_date: '2026-09-01T14:00:00.000Z' },
            ],
          }),
        );
        expect(p).toEqual(
          expect.objectContaining({
            before: 25,
            after: 0,
            delta: -25,
            unrecovered: 35,
          }),
        );
      });

      it.each(['Completed', 'NCNS', 'Pending'])(
        'tutoring %s → Cancelled banks',
        (from) => {
          expect(plan({ status: from }, 'Cancelled').delta).toBe(60);
        },
      );

      it.each([
        ['Completed', 'Cancelled'],
        ['NCNS', 'Cancelled'],
        ['Completed', 'Pending'],
        ['NCNS', 'Pending'],
      ])('make-up %s → %s refunds a batch dated at the session', (from, to) => {
        const p = plan({ type: SessionType.MAKE_UP, status: from }, to);
        expect(p.delta).toBe(60);
        expect(p.student!.make_up_batches!.at(-1)).toEqual({
          minutes: 60,
          earned_date: START,
        });
      });

      it.each([
        ['Cancelled', 'Completed'],
        ['Cancelled', 'NCNS'],
      ])('make-up %s → %s consumes', (from, to) => {
        expect(
          plan({ type: SessionType.MAKE_UP, status: from }, to).delta,
        ).toBe(-60);
      });

      it.each([
        [SessionType.TUTORING, 'Completed', 'NCNS'],
        [SessionType.TUTORING, 'NCNS', 'Completed'],
        [SessionType.TUTORING, 'Completed', 'Pending'],
        [SessionType.MAKE_UP, 'Completed', 'NCNS'],
        [SessionType.MAKE_UP, 'NCNS', 'Completed'],
        [SessionType.MAKE_UP, 'Cancelled', 'Pending'],
      ])('%s %s → %s moves nothing', (type, from, to) => {
        const p = plan({ type, status: from }, to);
        expect(p.delta).toBe(0);
        expect(p.student).toBeUndefined();
      });
    });

    it('a session without a student moves nothing', () => {
      expect(
        planAttendanceChange(session(), 'Cancelled', undefined, NOW),
      ).toEqual({
        before: 0,
        after: 0,
        delta: 0,
        unrecovered: 0,
      });
    });

    it('a session with unusable times moves nothing', () => {
      const p = plan({ end_datetime: START }, 'Cancelled');
      expect(p.delta).toBe(0);
      expect(p.student).toBeUndefined();
    });

    it('minutes banked for a session long past are already expired', () => {
      const old = session({
        start_datetime: '2026-01-05T14:00:00.000Z',
        end_datetime: '2026-01-05T15:00:00.000Z',
      });
      const p = planAttendanceChange(old, 'Cancelled', student(), NOW);
      expect(p.delta).toBe(0);
      expect(p.after).toBe(120);
    });

    it('never mutates the student it was given', () => {
      const given = student();
      plan({}, 'Cancelled', given);
      expect(given.make_up_batches).toHaveLength(1);
      expect(given.make_up_minutes).toBe(120);
    });

    it('defaults to the current time', () => {
      const soon = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const p = planAttendanceChange(
        session({
          start_datetime: soon,
          end_datetime: new Date(Date.parse(soon) + 30 * 60000).toISOString(),
        }),
        'Cancelled',
        student({ make_up_batches: [], make_up_minutes: 0 }),
      );
      expect(p.delta).toBe(30);
    });
  });

  describe('lockedFieldChanges', () => {
    const stored = session({ status: 'Completed' });

    it('is empty when only the notes differ', () => {
      expect(
        lockedFieldChanges(stored, { ...stored, notes: 'edited' }),
      ).toEqual([]);
    });

    it('treats equivalent timestamps and blank ids as unchanged', () => {
      expect(
        lockedFieldChanges(
          session({
            status: 'Completed',
            student_id: undefined,
            start_datetime: '2026-09-21T14:00:00Z',
          }),
          {
            ...stored,
            student_id: '',
            start_datetime: '2026-09-21T14:00:00.000Z',
            participants: [],
          },
        ),
      ).toEqual([]);
    });

    it('names every frozen field that changed', () => {
      expect(
        lockedFieldChanges(stored, {
          status: 'Cancelled',
          type: SessionType.MAKE_UP,
          start_datetime: '2026-09-21T13:00:00.000Z',
          end_datetime: '2026-09-21T16:00:00.000Z',
          student_id: 's-2',
          tutor_id: 't-2',
          participants: [{ id: 'p-1', name: 'Pat' }],
        }),
      ).toEqual([
        'status',
        'type',
        'start_datetime',
        'end_datetime',
        'student_id',
        'tutor_id',
        'participants',
      ]);
    });

    it('a payload missing a field counts as changing it', () => {
      expect(lockedFieldChanges(stored, {})).toEqual([
        'status',
        'type',
        'start_datetime',
        'end_datetime',
        'student_id',
        'tutor_id',
      ]);
    });

    it('an unparseable timestamp is a change unless it is identical', () => {
      const odd = session({ status: 'Completed', start_datetime: 'soon' });
      expect(lockedFieldChanges(odd, { ...odd })).toEqual([]);
      expect(
        lockedFieldChanges(odd, { ...odd, start_datetime: 'later' }),
      ).toEqual(['start_datetime']);
    });

    it('compares a roster by its members, whatever their order or names', () => {
      const group = session({
        status: 'Completed',
        type: SessionType.GROUP,
        participants: [
          { id: 'a', name: 'Al' },
          { id: 'b', name: 'Bo' },
        ],
      });
      expect(
        lockedFieldChanges(group, {
          ...group,
          participants: [
            { id: 'b', name: 'Bo B.' },
            { id: 'a', name: 'Al' },
          ],
        }),
      ).toEqual([]);
      expect(
        lockedFieldChanges(group, {
          ...group,
          participants: [{ id: 'a', name: 'Al' }],
        }),
      ).toEqual(['participants']);
      expect(
        lockedFieldChanges(group, {
          ...group,
          participants: [
            null as never,
            { id: 'a', name: 'Al' },
            { id: 'b', name: 'Bo' },
          ],
        }),
      ).toEqual(['participants']);
    });
  });
});
