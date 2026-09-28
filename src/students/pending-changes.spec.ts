import {
  applyPromotion,
  LEGACY_PENDING_FIELDS,
  pendingChangesOf,
  planPromotion,
  sanitizePendingChanges,
  UNKNOWN_START,
  withNoticeSent,
} from './pending-changes';
import { PendingChange, Student } from '../models/student.model';

const slot = { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' };
const oct: PendingChange = { package: 'Excel', effective: '2026-10-01' };
const jan: PendingChange = {
  package: 'Succeed',
  effective: '2027-01-01',
  schedule: [slot],
};
const student = (over: Partial<Student> = {}): Student =>
  ({ id: 's-1', package: 'Thrive', ...over }) as Student;

describe('pending-changes', () => {
  it('LEGACY_PENDING_FIELDS names every single-change scalar', () => {
    expect([...LEGACY_PENDING_FIELDS]).toEqual([
      'pending_package',
      'pending_custom_monthly_cost',
      'pending_custom_sessions_per_week',
      'pending_custom_session_length_min',
      'pending_package_effective',
      'pending_schedule',
      'pending_change_notice_sent',
    ]);
  });

  describe('pendingChangesOf', () => {
    it('returns the list sorted by effective, as fresh copies', () => {
      const s = student({ pending_changes: [jan, oct] });
      const result = pendingChangesOf(s);
      expect(result.map((c) => c.effective)).toEqual([
        '2026-10-01',
        '2027-01-01',
      ]);
      expect(result[0]).not.toBe(oct);
      expect(s.pending_changes![0]).toBe(jan); // input untouched
    });

    it('drops malformed entries', () => {
      const s = student({
        pending_changes: [
          oct,
          null as unknown as PendingChange,
          { package: '', effective: '2026-11-01' },
          { package: 'Excel' } as PendingChange,
        ],
      });
      expect(pendingChangesOf(s)).toEqual([oct]);
    });

    it('folds a legacy single change into a one-entry list (with schedule, customs, notice)', () => {
      const s = student({
        pending_package: 'Custom',
        pending_package_effective: '2026-10-01',
        pending_custom_monthly_cost: 400,
        pending_custom_sessions_per_week: 2,
        pending_custom_session_length_min: 45,
        pending_schedule: [slot],
        pending_change_notice_sent: '2026-10-01',
      });
      expect(pendingChangesOf(s)).toEqual([
        {
          package: 'Custom',
          effective: '2026-10-01',
          custom_monthly_cost: 400,
          custom_sessions_per_week: 2,
          custom_session_length_min: 45,
          schedule: [slot],
          notice_sent: '2026-10-01',
        },
      ]);
    });

    it('folds a bare legacy change without optional fields', () => {
      const s = student({
        pending_package: 'Excel',
        pending_package_effective: '2026-10-01',
        pending_schedule: [],
      });
      expect(pendingChangesOf(s)).toEqual([oct]);
    });

    it('prefers the list over leftover legacy scalars, and is empty with neither', () => {
      expect(
        pendingChangesOf(
          student({
            pending_changes: [oct],
            pending_package: 'Succeed',
            pending_package_effective: '2026-11-01',
          }),
        ),
      ).toEqual([oct]);
      expect(pendingChangesOf(student())).toEqual([]);
      expect(pendingChangesOf(student({ pending_package: 'Excel' }))).toEqual(
        [],
      );
      expect(pendingChangesOf(student({ pending_changes: [] }))).toEqual([]);
    });
  });

  describe('sanitizePendingChanges', () => {
    it('keeps known keys, strips nested null/undefined, omits empty schedule, sorts', () => {
      const raw = [
        {
          package: 'Succeed',
          effective: '2027-01-01',
          custom_monthly_cost: null,
          custom_sessions_per_week: undefined,
          custom_session_length_min: 'x',
          schedule: [],
          notice_sent: '',
          extra: 'nope',
        },
        {
          package: 'Custom',
          effective: '2026-10-01',
          custom_monthly_cost: 400,
          custom_sessions_per_week: 2,
          custom_session_length_min: 45,
          schedule: [slot, null, 'bad'],
          notice_sent: '2026-10-01',
        },
      ];
      expect(sanitizePendingChanges(raw)).toEqual([
        {
          package: 'Custom',
          effective: '2026-10-01',
          custom_monthly_cost: 400,
          custom_sessions_per_week: 2,
          custom_session_length_min: 45,
          schedule: [slot],
          notice_sent: '2026-10-01',
        },
        { package: 'Succeed', effective: '2027-01-01' },
      ]);
    });

    it('drops entries that are not objects or lack a package/effective', () => {
      expect(
        sanitizePendingChanges([
          null,
          'x',
          { package: 'Excel' },
          { effective: '2026-10-01' },
          {
            package: 'Excel',
            effective: '2026-10-01',
            custom_monthly_cost: NaN,
          },
        ]),
      ).toEqual([{ package: 'Excel', effective: '2026-10-01' }]);
    });
  });

  describe('planPromotion', () => {
    it('is null when nothing is due', () => {
      expect(
        planPromotion(student({ pending_changes: [oct] }), '2026-09-01'),
      ).toBeNull();
      expect(planPromotion(student(), '2026-10-01')).toBeNull();
    });

    it('promotes a single on-time change (boundary: effective === monthStartKey)', () => {
      const plan = planPromotion(
        student({ pending_changes: [oct, jan] }),
        '2026-10-01',
      );
      expect(plan).toEqual({ due: [oct], remaining: [jan], last: oct });
      expect(plan!.schedule).toBeUndefined();
    });

    it('applies every due change: last wins, schedule from the last schedule-bearing due entry', () => {
      const nov: PendingChange = {
        package: 'Apex',
        effective: '2026-11-01',
        schedule: [{ ...slot, weekday: 'TUESDAY' }],
      };
      const dec: PendingChange = { package: 'Thrive', effective: '2026-12-01' };
      const plan = planPromotion(
        student({ pending_changes: [jan, dec, nov, oct] }),
        '2026-12-01',
      );
      expect(plan!.due.map((c) => c.package)).toEqual([
        'Excel',
        'Apex',
        'Thrive',
      ]);
      expect(plan!.last).toEqual(dec);
      expect(plan!.schedule).toEqual(nov.schedule);
      expect(plan!.remaining).toEqual([jan]);
    });

    it('works on a legacy-shaped student', () => {
      const plan = planPromotion(
        student({
          pending_package: 'Excel',
          pending_package_effective: '2026-09-01',
          pending_schedule: [slot],
        }),
        '2026-10-01',
      );
      expect(plan!.last.package).toBe('Excel');
      expect(plan!.schedule).toEqual([slot]);
      expect(plan!.remaining).toEqual([]);
    });
  });

  describe('withNoticeSent', () => {
    it('stamps only the matching entry, copying every entry', () => {
      const result = withNoticeSent([oct, jan], '2027-01-01');
      expect(result).toEqual([oct, { ...jan, notice_sent: '2027-01-01' }]);
      expect(result[0]).not.toBe(oct);
      expect(jan.notice_sent).toBeUndefined();
    });
  });

  describe('sanitizePendingChanges price', () => {
    it('keeps a valid price, including $0, and drops anything else', () => {
      const out = sanitizePendingChanges([
        { package: 'A', effective: '2026-10-01', price_override: 300.5 },
        { package: 'B', effective: '2026-10-02', price_override: 0 },
        { package: 'C', effective: '2026-10-03', price_override: -1 },
        { package: 'D', effective: '2026-10-04', price_override: '5' },
        { package: 'E', effective: '2026-10-05', price_override: NaN },
        { package: 'F', effective: '2026-10-06', price_override: Infinity },
        { package: 'G', effective: '2026-10-07', price_override: null },
      ]);
      expect(out.map((c) => c.price_override)).toEqual([
        300.5,
        0,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect('price_override' in out[2]).toBe(false);
    });
  });

  describe('applyPromotion', () => {
    const tuesday = {
      weekday: 'TUESDAY',
      start_time: '10:00',
      end_time: '10:30',
    };
    const enrolled = (over: Partial<Student> = {}): Student =>
      student({
        package_start_date: '2026-05-01T00:00:00',
        schedule: [slot],
        pending_changes: [
          { package: 'Excel', effective: '2026-10-14', schedule: [tuesday] },
        ],
        ...over,
      });

    it('is null when nothing is due', () => {
      expect(applyPromotion(enrolled(), '2026-10-13')).toBeNull();
      expect(applyPromotion(student(), '2026-10-14')).toBeNull();
    });

    it('promotes a mid-month change on its date and records the old package', () => {
      const result = applyPromotion(enrolled(), '2026-10-14')!;
      expect(result.sets).toEqual({
        package: 'Excel',
        package_start_date: '2026-10-14T00:00:00',
        schedule: [tuesday],
        package_history: [
          {
            package: 'Thrive',
            start: '2026-05-01',
            end: '2026-10-13',
            schedule: [slot],
          },
        ],
      });
      expect(result.removes).toEqual([
        ...LEGACY_PENDING_FIELDS,
        'pending_changes',
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
        'price_override',
        'first_week_sessions',
      ]);
    });

    it('catches up a change that came due earlier', () => {
      const result = applyPromotion(enrolled(), '2026-10-20')!;
      expect(result.sets.package_start_date).toBe('2026-10-14T00:00:00');
    });

    it('returns the student as it stands afterwards', () => {
      const before = enrolled({
        price_override: 250,
        discount_percent: 10,
        first_week_sessions: [
          { date: '2026-05-02', start_time: '10:00', end_time: '10:30' },
        ],
        pending_package: 'Old',
        custom_monthly_cost: 1,
      });
      const { promoted } = applyPromotion(before, '2026-10-14')!;
      expect(promoted.package).toBe('Excel');
      expect(promoted.schedule).toEqual([tuesday]);
      expect(promoted.discount_percent).toBe(10);
      expect(promoted.id).toBe('s-1');
      for (const gone of [
        'pending_changes',
        'price_override',
        'first_week_sessions',
        'pending_package',
        'custom_monthly_cost',
      ]) {
        expect(gone in promoted).toBe(false);
      }
      // The input is never mutated.
      expect(before.package).toBe('Thrive');
      expect(before.price_override).toBe(250);
    });

    it('snapshots the closed package with its price, discount and first-week sessions', () => {
      const firstWeek = [
        { date: '2026-05-02', start_time: '10:00', end_time: '10:30' },
      ];
      const result = applyPromotion(
        enrolled({
          price_override: 250,
          discount_percent: 10,
          first_week_sessions: [...firstWeek, null as never],
        }),
        '2026-10-14',
      )!;
      expect(result.sets.package_history).toEqual([
        {
          package: 'Thrive',
          start: '2026-05-01',
          end: '2026-10-13',
          price_override: 250,
          discount_percent: 10,
          schedule: [slot],
          first_week_sessions: firstWeek,
        },
      ]);
    });

    it('never writes null, undefined or empty members into history', () => {
      const result = applyPromotion(
        enrolled({
          price_override: null,
          discount_percent: 0,
          schedule: [],
          first_week_sessions: [],
          custom_monthly_cost: 99,
        }),
        '2026-10-14',
      )!;
      expect(result.sets.package_history).toEqual([
        { package: 'Thrive', start: '2026-05-01', end: '2026-10-13' },
      ]);
    });

    it('keeps the custom values of a closed Custom package', () => {
      const result = applyPromotion(
        enrolled({
          package: 'Custom',
          custom_monthly_cost: 410.4,
          custom_sessions_per_week: 2,
          custom_session_length_min: 45,
        }),
        '2026-10-14',
      )!;
      expect((result.sets.package_history as unknown[])[0]).toEqual({
        package: 'Custom',
        start: '2026-05-01',
        end: '2026-10-13',
        custom_monthly_cost: 410.4,
        custom_sessions_per_week: 2,
        custom_session_length_min: 45,
        schedule: [slot],
      });
    });

    it('a student without a start date gets the unknown start', () => {
      expect(UNKNOWN_START).toBe('1970-01-01');
      const result = applyPromotion(
        enrolled({ package_start_date: undefined }),
        '2026-10-14',
      )!;
      expect(
        (result.sets.package_history as { start: string }[])[0].start,
      ).toBe('1970-01-01');
    });

    it('a student without a package records no closed segment', () => {
      const result = applyPromotion(enrolled({ package: '' }), '2026-10-14')!;
      expect('package_history' in result.sets).toBe(false);
      expect(result.sets.package).toBe('Excel');
    });

    it('appends to existing history, dropping malformed entries', () => {
      const result = applyPromotion(
        enrolled({
          package_history: [
            { package: 'Start', start: '2026-01-01', end: '2026-04-30' },
            { package: '', start: '2026-01-01', end: '2026-04-30' },
            { package: 'X', start: '', end: '2026-04-30' },
            { package: 'X', start: '2026-01-01', end: '' },
            null as never,
          ],
        }),
        '2026-10-14',
      )!;
      expect(
        (result.sets.package_history as { package: string }[]).map(
          (h) => h.package,
        ),
      ).toEqual(['Start', 'Thrive']);
    });

    it('skips a segment that would end before it starts', () => {
      const result = applyPromotion(
        enrolled({ package_start_date: '2026-10-14T00:00:00' }),
        '2026-10-14',
      )!;
      expect('package_history' in result.sets).toBe(false);
      // A one-day segment is real.
      const oneDay = applyPromotion(
        enrolled({ package_start_date: '2026-10-13T00:00:00' }),
        '2026-10-14',
      )!;
      expect(oneDay.sets.package_history).toEqual([
        {
          package: 'Thrive',
          start: '2026-10-13',
          end: '2026-10-13',
          schedule: [slot],
        },
      ]);
    });

    it('several due changes: each superseded one becomes history, the last wins', () => {
      const result = applyPromotion(
        enrolled({
          discount_percent: 5,
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', price_override: 200 },
            {
              package: 'Custom',
              effective: '2026-11-05',
              custom_monthly_cost: 500,
              custom_sessions_per_week: 2,
              custom_session_length_min: 45,
              schedule: [tuesday],
            },
            { package: 'Apex', effective: '2026-12-01', price_override: 300 },
            { package: 'Start', effective: '2027-01-10' },
          ],
        }),
        '2026-12-01',
      )!;
      expect(result.sets).toEqual({
        package: 'Apex',
        package_start_date: '2026-12-01T00:00:00',
        schedule: [tuesday],
        price_override: 300,
        pending_changes: [{ package: 'Start', effective: '2027-01-10' }],
        package_history: [
          {
            package: 'Thrive',
            start: '2026-05-01',
            end: '2026-10-13',
            discount_percent: 5,
            schedule: [slot],
          },
          {
            package: 'Excel',
            start: '2026-10-14',
            end: '2026-11-04',
            price_override: 200,
            discount_percent: 5,
            // No schedule of its own: the one in force carries on.
            schedule: [slot],
          },
          {
            package: 'Custom',
            start: '2026-11-05',
            end: '2026-11-30',
            custom_monthly_cost: 500,
            custom_sessions_per_week: 2,
            custom_session_length_min: 45,
            discount_percent: 5,
            schedule: [tuesday],
          },
        ],
      });
      expect(result.removes).toEqual([
        ...LEGACY_PENDING_FIELDS,
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
        'first_week_sessions',
      ]);
    });

    it('a Custom change keeps its values and only the ones it has', () => {
      const result = applyPromotion(
        enrolled({
          pending_changes: [
            {
              package: 'Custom',
              effective: '2026-10-14',
              custom_monthly_cost: 500,
            },
          ],
        }),
        '2026-10-14',
      )!;
      expect(result.sets.custom_monthly_cost).toBe(500);
      expect('custom_sessions_per_week' in result.sets).toBe(false);
      expect('schedule' in result.sets).toBe(false);
      expect(result.removes).not.toContain('custom_monthly_cost');
      expect(result.removes).toContain('price_override');
    });

    it('a $0 carried price is kept, not removed', () => {
      const result = applyPromotion(
        enrolled({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14', price_override: 0 },
          ],
        }),
        '2026-10-14',
      )!;
      expect(result.sets.price_override).toBe(0);
      expect(result.removes).not.toContain('price_override');
    });

    it('reads a datetime-shaped effective by its date', () => {
      const result = applyPromotion(
        enrolled({
          pending_changes: [
            { package: 'Excel', effective: '2026-10-14T00:00:00' },
          ],
        }),
        '2026-10-15',
      )!;
      expect(result.sets.package_start_date).toBe('2026-10-14T00:00:00');
      expect((result.sets.package_history as { end: string }[])[0].end).toBe(
        '2026-10-13',
      );
    });
  });
});
