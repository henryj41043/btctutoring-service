import {
  LEGACY_PENDING_FIELDS,
  pendingChangesOf,
  planPromotion,
  sanitizePendingChanges,
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
});
