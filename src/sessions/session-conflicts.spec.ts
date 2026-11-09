import { Session, SessionType } from '../models/session.model';
import {
  conflictMessage,
  conflictSummary,
  conflictWindow,
  definedFields,
  findConflicts,
  holdsTime,
  movesSlot,
  slotPhrase,
  studentIdsOf,
  timesOverlap,
} from './session-conflicts';

// Oct 23 2026 is a Friday; Eastern is UTC-4 (EDT) that day.
const s = (over: Partial<Session> = {}): Session =>
  ({
    id: 'booked',
    type: SessionType.MAKE_UP,
    status: 'Pending',
    start_datetime: '2026-10-23T14:00:00.000Z', // 10:00 AM ET
    end_datetime: '2026-10-23T14:45:00.000Z', // 10:45 AM ET
    tutor_id: 't-emily',
    tutor_name: 'Emily Sentman',
    student_id: 'st-graham',
    student_name: 'Graham Burdick',
    ...over,
  }) as Session;

const candidate = (over: Partial<Session> = {}): Session =>
  s({ id: undefined, ...over });

describe('session-conflicts', () => {
  describe('holdsTime', () => {
    it('a pending, completed or no-show session holds its time', () => {
      expect(holdsTime(s())).toBe(true);
      expect(holdsTime(s({ status: 'Completed' }))).toBe(true);
      expect(holdsTime(s({ status: 'NCNS' }))).toBe(true);
    });

    it('a cancelled session frees its time', () => {
      expect(holdsTime(s({ status: 'Cancelled' }))).toBe(false);
    });

    it('a session without a valid, positive span holds nothing', () => {
      expect(holdsTime(s({ start_datetime: 'nope' }))).toBe(false);
      expect(holdsTime(s({ end_datetime: 'nope' }))).toBe(false);
      expect(holdsTime(s({ end_datetime: s().start_datetime }))).toBe(false);
    });
  });

  describe('studentIdsOf', () => {
    it('joins the student and a group roster without duplicates or blanks', () => {
      expect(
        studentIdsOf(
          s({
            student_id: 'a',
            participants: [
              { id: 'b', name: 'B' },
              { id: 'a', name: 'A' },
              { id: '', name: 'blank' },
            ],
          }),
        ),
      ).toEqual(['a', 'b']);
      expect(studentIdsOf(s({ student_id: undefined }))).toEqual([]);
    });
  });

  describe('timesOverlap', () => {
    it('intersecting spans overlap', () => {
      expect(
        timesOverlap(
          s(),
          s({
            start_datetime: '2026-10-23T14:30:00.000Z',
            end_datetime: '2026-10-23T15:30:00.000Z',
          }),
        ),
      ).toBe(true);
    });

    it('back-to-back spans do not overlap, either way round', () => {
      const after = s({
        start_datetime: '2026-10-23T14:45:00.000Z',
        end_datetime: '2026-10-23T15:30:00.000Z',
      });
      expect(timesOverlap(s(), after)).toBe(false);
      expect(timesOverlap(after, s())).toBe(false);
    });
  });

  describe('messages', () => {
    it('reads the slot in Eastern time', () => {
      expect(slotPhrase(s())).toBe('from 10:00 AM to 10:45 AM on Fri, Oct 23');
    });

    it('names the tutor and the booked student for a tutor clash', () => {
      expect(conflictMessage(candidate(), s(), 'tutor')).toBe(
        'Emily Sentman already has a make-up with Graham Burdick from 10:00 AM to 10:45 AM on Fri, Oct 23.',
      );
    });

    it('names the student and the other tutor for a student clash', () => {
      expect(
        conflictMessage(
          candidate(),
          s({ type: SessionType.TUTORING, tutor_name: 'Karrie Tillotson' }),
          'student',
        ),
      ).toBe(
        'Graham Burdick already has a session with Karrie Tillotson from 10:00 AM to 10:45 AM on Fri, Oct 23.',
      );
    });

    it.each([
      [SessionType.ADMIN, 'Admin Time'],
      [SessionType.TRIAL, 'a trial'],
      [SessionType.CUSTOM_TRIAL, 'a custom trial'],
      [undefined, 'a session'],
    ])('phrases a %s session as "%s"', (type, phrase) => {
      expect(
        conflictMessage(
          candidate(),
          s({ type: type as SessionType, student_name: undefined }),
          'tutor',
        ),
      ).toBe(
        `Emily Sentman already has ${phrase} from 10:00 AM to 10:45 AM on Fri, Oct 23.`,
      );
    });

    it('a group session names no single student', () => {
      expect(
        conflictMessage(candidate(), s({ type: SessionType.GROUP }), 'tutor'),
      ).toBe(
        'Emily Sentman already has a BTC & Me session from 10:00 AM to 10:45 AM on Fri, Oct 23.',
      );
    });

    it('falls back to the candidate names, then to neutral words', () => {
      const bare = s({ tutor_name: undefined, student_name: undefined });
      expect(conflictMessage(candidate(), bare, 'tutor')).toContain(
        'Emily Sentman already has a make-up from',
      );
      expect(conflictMessage(candidate(), bare, 'student')).toBe(
        'Graham Burdick already has a make-up from 10:00 AM to 10:45 AM on Fri, Oct 23.',
      );
      const none = candidate({
        tutor_name: undefined,
        student_name: undefined,
      });
      expect(conflictMessage(none, bare, 'tutor')).toMatch(/^This tutor /);
      expect(conflictMessage(none, bare, 'student')).toMatch(/^This student /);
    });

    it('summarizes one hit as its sentence, several as a count with the first three', () => {
      const hit = (n: number) => ({
        index: n,
        existing: s(),
        shared: 'tutor' as const,
        message: `M${n}.`,
      });
      expect(conflictSummary([hit(0)])).toBe('M0.');
      expect(conflictSummary([hit(0), hit(1)])).toBe(
        '2 sessions overlap sessions already booked. M0. M1.',
      );
      expect(conflictSummary([0, 1, 2, 3, 4].map(hit))).toBe(
        '5 sessions overlap sessions already booked. M0. M1. M2. (and 2 more)',
      );
    });
  });

  describe('findConflicts', () => {
    it('catches the exact duplicate make-up (client screenshot, Oct 23)', () => {
      const hits = findConflicts([candidate()], [s()]);
      expect(hits).toEqual([
        expect.objectContaining({ index: 0, shared: 'tutor', existing: s() }),
      ]);
    });

    it('catches the same tutor with another student at an overlapping time', () => {
      const hits = findConflicts(
        [
          candidate({
            student_id: 'st-other',
            start_datetime: '2026-10-23T14:30:00.000Z',
            end_datetime: '2026-10-23T15:15:00.000Z',
          }),
        ],
        [s()],
      );
      expect(hits[0]).toMatchObject({ shared: 'tutor' });
    });

    it('catches the same student with another tutor', () => {
      const hits = findConflicts(
        [candidate({ tutor_id: 't-karrie', tutor_name: 'Karrie' })],
        [s()],
      );
      expect(hits[0]).toMatchObject({ shared: 'student' });
    });

    it('catches a student booked inside a group roster', () => {
      const group = s({
        type: SessionType.GROUP,
        tutor_id: 't-x',
        student_id: undefined,
        participants: [{ id: 'st-graham', name: 'Graham Burdick' }],
      });
      expect(
        findConflicts([candidate({ tutor_id: 't-karrie' })], [group])[0],
      ).toMatchObject({ shared: 'student' });
    });

    it('Admin Time (no student) still blocks the tutor', () => {
      const admin = candidate({
        type: SessionType.ADMIN,
        student_id: undefined,
        student_name: undefined,
      });
      expect(findConflicts([admin], [s()])[0]).toMatchObject({
        shared: 'tutor',
      });
      expect(findConflicts([admin], [s({ tutor_id: 't-other' })])).toEqual([]);
    });

    it('allows back-to-back, other people, cancelled and ignored sessions', () => {
      expect(
        findConflicts(
          [
            candidate({
              start_datetime: '2026-10-23T14:45:00.000Z',
              end_datetime: '2026-10-23T15:30:00.000Z',
            }),
          ],
          [s()],
        ),
      ).toEqual([]);
      expect(
        findConflicts(
          [candidate({ tutor_id: 't-x', student_id: 'st-x' })],
          [s()],
        ),
      ).toEqual([]);
      expect(
        findConflicts([candidate()], [s({ status: 'Cancelled' })]),
      ).toEqual([]);
      expect(findConflicts([candidate()], [s()], ['booked'])).toEqual([]);
    });

    it('never checks a cancelled candidate', () => {
      expect(
        findConflicts([candidate({ status: 'Cancelled' })], [s()]),
      ).toEqual([]);
    });

    it('a candidate with no tutor and no student conflicts with nobody', () => {
      expect(
        findConflicts(
          [candidate({ tutor_id: undefined, student_id: undefined })],
          [s()],
        ),
      ).toEqual([]);
    });

    it('a batch may not double-book itself: the later copy is the hit', () => {
      const hits = findConflicts([candidate(), candidate()], []);
      expect(hits).toHaveLength(1);
      expect(hits[0].index).toBe(1);
      expect(hits[0].existing.id).toBeUndefined();
    });
  });

  describe('conflictWindow', () => {
    it('reaches a day back from the first start to the last end', () => {
      expect(
        conflictWindow([
          candidate(),
          candidate({
            start_datetime: '2026-10-25T14:00:00.000Z',
            end_datetime: '2026-10-25T15:00:00.000Z',
          }),
        ]),
      ).toEqual({
        from: '2026-10-22T14:00:00.000Z',
        to: '2026-10-25T15:00:00.000Z',
      });
    });

    it('is null when no candidate holds time', () => {
      expect(conflictWindow([candidate({ status: 'Cancelled' })])).toBeNull();
      expect(conflictWindow([])).toBeNull();
    });
  });

  describe('editing', () => {
    it('definedFields drops undefined values only', () => {
      expect(definedFields({ notes: '', tutor_id: undefined })).toEqual({
        notes: '',
      });
    });

    it('a notes or name edit does not move the slot', () => {
      expect(movesSlot(s(), { notes: 'x', tutor_name: 'E' })).toBe(false);
      expect(movesSlot(s(), {})).toBe(false);
    });

    it('an equivalent timestamp is not a move', () => {
      expect(movesSlot(s(), { start_datetime: '2026-10-23T14:00:00Z' })).toBe(
        false,
      );
    });

    it.each([
      ['start', { start_datetime: '2026-10-23T15:00:00.000Z' }],
      ['end', { end_datetime: '2026-10-23T15:00:00.000Z' }],
      ['tutor', { tutor_id: 't-other' }],
      ['student', { student_id: 'st-other' }],
      ['roster', { participants: [{ id: 'p', name: 'P' }] }],
    ])('a new %s moves the slot', (_n, payload) => {
      expect(movesSlot(s(), payload as Partial<Session>)).toBe(true);
    });

    it('putting a cancelled session back on the calendar moves the slot', () => {
      expect(movesSlot(s({ status: 'Cancelled' }), { status: 'Pending' })).toBe(
        true,
      );
      expect(movesSlot(s({ status: 'Cancelled' }), { notes: 'x' })).toBe(false);
    });

    it('missing fields on either side compare as blank', () => {
      expect(
        movesSlot(s({ tutor_id: undefined }), { tutor_id: undefined }),
      ).toBe(false);
      expect(
        movesSlot(s({ start_datetime: undefined as unknown as string }), {}),
      ).toBe(false);
    });
  });
});
