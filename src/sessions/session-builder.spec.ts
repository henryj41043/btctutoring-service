import {
  buildGroupRollSessions,
  buildTutoringMonthSessions,
  governingSlotsForMonth,
  GROUP_SESSION_MINUTES,
  HORIZON_MONTHS_AHEAD,
  normalizeMonth,
} from './session-builder';
import { Session, SessionType } from '../models/session.model';
import { Student } from '../models/student.model';

describe('session-builder', () => {
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
  const names: Record<string, string> = { 't-1': 'Tess', 't-2': 'Theo' };
  const tutorNameById = (id: string) => names[id];

  it('exposes the horizon constant', () => {
    expect(HORIZON_MONTHS_AHEAD).toBe(3);
  });

  describe('normalizeMonth', () => {
    it('passes an in-range month through and rolls overflow into the next year', () => {
      expect(normalizeMonth(2026, 6)).toEqual({ year: 2026, month: 6 });
      expect(normalizeMonth(2026, 12)).toEqual({ year: 2027, month: 0 });
      expect(normalizeMonth(2026, 14)).toEqual({ year: 2027, month: 2 });
    });
  });

  describe('buildTutoringMonthSessions', () => {
    const build = (
      over: Partial<Parameters<typeof buildTutoringMonthSessions>[0]> = {},
    ) =>
      buildTutoringMonthSessions({
        student: student(),
        slots: student().schedule!,
        tutorNameById,
        year: 2026,
        month: 6,
        ...over,
      });

    // July 2026: Mondays 6,13,20,27 (4) + Wednesdays 1,8,15,22,29 (5).
    it('generates every slot occurrence of the month as PENDING tutoring', () => {
      const out = build();
      expect(out).toHaveLength(9);
      expect(
        out.every(
          (s) => s.type === SessionType.TUTORING && s.status === 'Pending',
        ),
      ).toBe(true);
      expect(out[0]).toMatchObject({
        student_id: 's-1',
        student_name: 'Pat',
        tutor_id: 't-1',
        tutor_name: 'Tess',
        notes: '',
        start_datetime: '2026-07-06T14:00:00.000Z', // 10:00 EDT
        end_datetime: '2026-07-06T14:30:00.000Z',
      });
    });

    it('pins Eastern wall time across the DST switch', () => {
      const oct = build({ month: 9 });
      const nov = build({ month: 10 });
      expect(
        oct.find((s) => s.start_datetime.startsWith('2026-10-26'))
          ?.start_datetime,
      ).toBe(
        '2026-10-26T14:00:00.000Z', // EDT
      );
      expect(
        nov.find((s) => s.start_datetime.startsWith('2026-11-02'))
          ?.start_datetime,
      ).toBe(
        '2026-11-02T15:00:00.000Z', // EST after Nov 1
      );
    });

    it('uses one series per effective tutor and resolves each name', () => {
      const out = build({
        slots: [
          { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          {
            weekday: 'WEDNESDAY',
            start_time: '10:00',
            end_time: '10:30',
            tutor_id: 't-2',
          },
        ],
      });
      const mondays = out.filter((s) => s.tutor_id === 't-1');
      const wednesdays = out.filter((s) => s.tutor_id === 't-2');
      expect(mondays).toHaveLength(4);
      expect(wednesdays).toHaveLength(5);
      expect(new Set(mondays.map((s) => s.series_id)).size).toBe(1);
      expect(new Set(wednesdays.map((s) => s.series_id)).size).toBe(1);
      expect(mondays[0].series_id).not.toBe(wednesdays[0].series_id);
      expect(wednesdays[0].tutor_name).toBe('Theo');
    });

    it('blanks the tutor name when the tutor is unknown', () => {
      const out = build({ student: student({ assigned_tutor_id: 't-x' }) });
      expect(out[0].tutor_id).toBe('t-x');
      expect(out[0].tutor_name).toBe('');
    });

    it('skips days before notBefore within the month', () => {
      const out = build({ notBefore: new Date(2026, 6, 15) });
      // Mon 20,27 + Wed 15,22,29
      expect(out).toHaveLength(5);
      expect(out.every((s) => s.start_datetime >= '2026-07-15')).toBe(true);
    });

    it('ignores notBefore that falls in another month', () => {
      expect(build({ notBefore: new Date(2026, 5, 15) })).toHaveLength(9);
    });

    it('reuses a supplied series id per tutor and mints one otherwise', () => {
      const reused = build({ seriesIdByTutor: new Map([['t-1', 'series-A']]) });
      expect(reused.every((s) => s.series_id === 'series-A')).toBe(true);
      const minted = build({ seriesIdByTutor: new Map([['t-9', 'series-Z']]) });
      expect(minted[0].series_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('returns nothing for an empty slot list', () => {
      expect(build({ slots: [] })).toEqual([]);
    });

    it('normalises an overflowed month', () => {
      const out = build({ month: 12 }); // January 2027: Mon 4,11,18,25 + Wed 6,13,20,27
      expect(out).toHaveLength(8);
      expect(out[0].start_datetime).toBe('2027-01-04T15:00:00.000Z');
    });
  });

  describe('buildGroupRollSessions', () => {
    const latest = (over: Partial<Session> = {}): Session =>
      ({
        id: 'g-1',
        type: 'GROUP',
        status: 'Pending',
        start_datetime: '2026-07-01T21:00:00.000Z', // Wed 5pm EDT
        end_datetime: '2026-07-01T21:45:00.000Z',
        tutor_id: 't-1',
        tutor_name: 'Tess',
        student_name: 'BTC & Me',
        series_id: 'grp-1',
        participants: [{ id: 's-1', name: 'Pat' }],
        ...over,
      }) as Session;

    it('generates the weekly occurrences of the target month from the latest one', () => {
      const out = buildGroupRollSessions(latest(), 2026, 7);
      // August 2026 Wednesdays: 5, 12, 19, 26
      expect(out.map((s) => s.start_datetime)).toEqual([
        '2026-08-05T21:00:00.000Z',
        '2026-08-12T21:00:00.000Z',
        '2026-08-19T21:00:00.000Z',
        '2026-08-26T21:00:00.000Z',
      ]);
      expect(out[0]).toMatchObject({
        type: 'GROUP',
        status: 'Pending',
        notes: '',
        tutor_id: 't-1',
        tutor_name: 'Tess',
        student_name: 'BTC & Me',
        series_id: 'grp-1',
        participants: [{ id: 's-1', name: 'Pat' }],
      });
      const len =
        new Date(out[0].end_datetime).getTime() -
        new Date(out[0].start_datetime).getTime();
      expect(len).toBe(GROUP_SESSION_MINUTES * 60000);
    });

    it('keeps 5pm Eastern after the fall-back transition', () => {
      const out = buildGroupRollSessions(
        latest({ start_datetime: '2026-10-28T21:00:00.000Z' }),
        2026,
        10,
      );
      expect(out[0].start_datetime).toBe('2026-11-04T22:00:00.000Z'); // EST
      expect(out).toHaveLength(4);
    });

    it('rolls December into January of the next year', () => {
      const out = buildGroupRollSessions(
        latest({ start_datetime: '2026-12-30T22:00:00.000Z' }),
        2026,
        12,
      );
      expect(out[0].start_datetime).toBe('2027-01-06T22:00:00.000Z');
      expect(out).toHaveLength(4);
    });
  });

  describe('governingSlotsForMonth', () => {
    const current = student().schedule!;
    const friday = [
      { weekday: 'FRIDAY', start_time: '09:00', end_time: '10:00' },
    ];

    it('uses the current schedule when no change is scheduled', () => {
      expect(governingSlotsForMonth(student(), '2026-10-01')).toEqual(current);
      expect(
        governingSlotsForMonth(student({ schedule: undefined }), '2026-10-01'),
      ).toEqual([]);
    });

    it('uses the current schedule for months before the change', () => {
      const s = student({
        pending_changes: [
          { package: 'Excel', effective: '2026-11-01', schedule: friday },
        ],
      });
      expect(governingSlotsForMonth(s, '2026-10-01')).toEqual(current);
    });

    it("uses the change's schedule from its effective month on", () => {
      const s = student({
        pending_changes: [
          { package: 'Excel', effective: '2026-11-01', schedule: friday },
        ],
      });
      expect(governingSlotsForMonth(s, '2026-11-01')).toEqual(friday);
      expect(governingSlotsForMonth(s, '2026-12-01')).toEqual(friday);
    });

    it('returns null (leave empty) when the governing change has no schedule', () => {
      const s = student({
        pending_changes: [{ package: 'Excel', effective: '2026-11-01' }],
      });
      expect(governingSlotsForMonth(s, '2026-11-01')).toBeNull();
      expect(
        governingSlotsForMonth(
          student({
            pending_changes: [
              { package: 'Excel', effective: '2026-11-01', schedule: [] },
            ],
          }),
          '2026-11-01',
        ),
      ).toBeNull();
    });

    it('lets the last reached change win', () => {
      const s = student({
        pending_changes: [
          { package: 'Excel', effective: '2026-11-01' },
          { package: 'Achieve', effective: '2026-12-01', schedule: friday },
        ],
      });
      expect(governingSlotsForMonth(s, '2026-11-01')).toBeNull();
      expect(governingSlotsForMonth(s, '2026-12-01')).toEqual(friday);
    });
  });
});
