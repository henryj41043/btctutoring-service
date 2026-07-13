import {
  midMonthAdjustment,
  monthKey,
  siblingDiscountedTotal,
  studentMonthlyCharge,
} from './billing-amount';
import { Student } from '../models/student.model';
import { Package } from './package.enum';

const succeed = (over: Partial<Student> = {}): Student =>
  ({ package: Package.SUCCEED, ...over }) as Student;

describe('studentMonthlyCharge (service)', () => {
  it('charges the full monthly cost for an ongoing month', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-05-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges full when started on the 1st', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges zero before the package starts', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-08-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(0);
  });

  it('charges full for a legacy student with no start date', () => {
    expect(studentMonthlyCharge(succeed(), 2026, 6)).toBe(362);
  });

  it('charges zero for an unconfigured custom package', () => {
    expect(
      studentMonthlyCharge(succeed({ package: Package.CUSTOM }), 2026, 6),
    ).toBe(0);
  });

  it('prorates the first partial month from the sessions received', () => {
    // July 2026 Wednesdays: 1, 8, 15, 22, 29. Start Jul 15 → 3 remaining →
    // perSession round(400*12/52,2)=92.31 → round(92.31*3,2)=276.93.
    const student = {
      package: Package.CUSTOM,
      custom_monthly_cost: 400,
      custom_sessions_per_week: 1,
      custom_session_length_min: 45,
      package_start_date: '2026-07-15T00:00:00',
      schedule: [
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
      ],
    } as Student;
    expect(studentMonthlyCharge(student, 2026, 6)).toBe(276.93);
  });

  it('charges one per-session cost when a single session remains (regression)', () => {
    // Succeed $362 → 83.54/wk → 41.77/session. June 2026: starting Tue Jun 30
    // (Tue/Thu schedule) leaves one session → $41.77, not $27.84.
    const student = succeed({
      package_start_date: '2026-06-30T00:00:00',
      schedule: [
        { weekday: 'TUESDAY', start_time: '10:00', end_time: '10:30' },
        { weekday: 'THURSDAY', start_time: '10:00', end_time: '10:30' },
      ] as Student['schedule'],
    });
    expect(studentMonthlyCharge(student, 2026, 5)).toBe(41.77);
  });

  it('falls back to full cost when a mid-month starter has no schedule', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-31T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('adds the old package portion in a mid-month package-change month', () => {
    // New package prorates from Jul 15 (3 Wednesdays → 276.93, as above) and the
    // stored old-package portion ($120) is added on top — but only for 2026-07.
    const student = {
      package: Package.CUSTOM,
      custom_monthly_cost: 400,
      custom_sessions_per_week: 1,
      custom_session_length_min: 45,
      package_start_date: '2026-07-15T00:00:00',
      schedule: [
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
      ],
      mid_month_prior_charge: 120,
      mid_month_change_period: '2026-07',
    } as Student;
    expect(studentMonthlyCharge(student, 2026, 6)).toBe(396.93);
    // The adjustment does not leak into any other month.
    expect(studentMonthlyCharge(student, 2026, 7)).toBe(400);
  });
});

describe('monthKey', () => {
  it('formats a 0-indexed month as YYYY-MM', () => {
    expect(monthKey(2026, 0)).toBe('2026-01');
    expect(monthKey(2026, 11)).toBe('2026-12');
  });
});

describe('midMonthAdjustment', () => {
  const base = (over: Partial<Student> = {}): Student => over as Student;

  it('returns the prior charge only for the matching period', () => {
    const student = base({
      mid_month_prior_charge: 88.5,
      mid_month_change_period: '2026-07',
    });
    expect(midMonthAdjustment(student, 2026, 6)).toBe(88.5);
    expect(midMonthAdjustment(student, 2026, 7)).toBe(0);
  });

  it('returns zero when there is no stored prior charge', () => {
    expect(
      midMonthAdjustment(base({ mid_month_change_period: '2026-07' }), 2026, 6),
    ).toBe(0);
    expect(midMonthAdjustment(base(), 2026, 6)).toBe(0);
  });
});

describe('siblingDiscountedTotal', () => {
  it('discounts the total when 2+ students are enrolled', () => {
    expect(siblingDiscountedTotal(1000, 10, 2)).toBe(900);
  });

  it('does not discount an only child', () => {
    expect(siblingDiscountedTotal(1000, 10, 1)).toBe(1000);
  });

  it('is a no-op when the percent is missing or zero', () => {
    expect(siblingDiscountedTotal(1000, undefined, 2)).toBe(1000);
    expect(siblingDiscountedTotal(1000, 0, 2)).toBe(1000);
  });

  it('clamps a percent above 100 to full discount', () => {
    expect(siblingDiscountedTotal(1000, 150, 2)).toBe(0);
  });

  it('rounds to the nearest penny', () => {
    expect(siblingDiscountedTotal(100, 33, 3)).toBe(67);
  });
});
