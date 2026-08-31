import {
  GROUP_MONTHLY_FEE,
  groupSessionFee,
  midMonthAdjustment,
  monthKey,
  packageFieldsForMonth,
  siblingDiscountedTotal,
  studentMonthlyCharge,
} from './billing-amount';
import { Student } from '../models/student.model';
import { TEST_CATALOG } from '../../test/package-catalog.fixture';

const succeed = (over: Partial<Student> = {}): Student =>
  ({ package: 'Succeed', ...over }) as Student;

describe('studentMonthlyCharge (service)', () => {
  it('charges the full monthly cost for an ongoing month', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-05-01T00:00:00' }),
        2026,
        6,
        TEST_CATALOG,
      ),
    ).toBe(362);
  });

  it('charges full when started on the 1st', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-01T00:00:00' }),
        2026,
        6,
        TEST_CATALOG,
      ),
    ).toBe(362);
  });

  it('charges zero before the package starts', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-08-01T00:00:00' }),
        2026,
        6,
        TEST_CATALOG,
      ),
    ).toBe(0);
  });

  it('charges full for a legacy student with no start date', () => {
    expect(studentMonthlyCharge(succeed(), 2026, 6, TEST_CATALOG)).toBe(362);
  });

  it('charges zero for an unconfigured custom package', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package: 'Custom' }),
        2026,
        6,
        TEST_CATALOG,
      ),
    ).toBe(0);
  });

  it('prorates the first partial month from the sessions received', () => {
    // July 2026 Wednesdays: 1, 8, 15, 22, 29. Start Jul 15 → 3 remaining →
    // perSession round(400*12/52,2)=92.31 → round(92.31*3,2)=276.93.
    const student = {
      package: 'Custom',
      custom_monthly_cost: 400,
      custom_sessions_per_week: 1,
      custom_session_length_min: 45,
      package_start_date: '2026-07-15T00:00:00',
      schedule: [
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
      ],
    } as Student;
    expect(studentMonthlyCharge(student, 2026, 6, TEST_CATALOG)).toBe(276.93);
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
    expect(studentMonthlyCharge(student, 2026, 5, TEST_CATALOG)).toBe(41.77);
  });

  it('falls back to full cost when a mid-month starter has no schedule', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-31T00:00:00' }),
        2026,
        6,
        TEST_CATALOG,
      ),
    ).toBe(362);
  });

  it('adds the old package portion in a mid-month package-change month', () => {
    // New package prorates from Jul 15 (3 Wednesdays → 276.93, as above) and the
    // stored old-package portion ($120) is added on top — but only for 2026-07.
    const student = {
      package: 'Custom',
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
    expect(studentMonthlyCharge(student, 2026, 6, TEST_CATALOG)).toBe(396.93);
    // The adjustment does not leak into any other month.
    expect(studentMonthlyCharge(student, 2026, 7, TEST_CATALOG)).toBe(400);
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
  it('discounts the total when 3+ students are enrolled', () => {
    expect(siblingDiscountedTotal(1000, 10, 3)).toBe(900);
  });

  it('does not discount families with fewer than 3 students', () => {
    expect(siblingDiscountedTotal(1000, 10, 1)).toBe(1000);
    expect(siblingDiscountedTotal(1000, 10, 2)).toBe(1000);
  });

  it('is a no-op when the percent is missing or zero', () => {
    expect(siblingDiscountedTotal(1000, undefined, 3)).toBe(1000);
    expect(siblingDiscountedTotal(1000, 0, 3)).toBe(1000);
  });

  it('clamps a percent above 100 to full discount', () => {
    expect(siblingDiscountedTotal(1000, 150, 3)).toBe(0);
  });

  it('rounds to the nearest penny', () => {
    expect(siblingDiscountedTotal(100, 33, 3)).toBe(67);
  });
});

describe('groupSessionFee', () => {
  it('charges the flat fee per enrolled student', () => {
    const students = [
      { btc_and_me: true },
      { btc_and_me: true },
      { btc_and_me: false },
      {},
    ] as never[];
    expect(groupSessionFee(students)).toBe(2 * GROUP_MONTHLY_FEE);
  });

  it('is zero for a family with no enrollees', () => {
    expect(groupSessionFee([])).toBe(0);
    expect(groupSessionFee([{ btc_and_me: false }] as never[])).toBe(0);
  });
});

describe('packageFieldsForMonth', () => {
  const pendingStudent = (over: Record<string, unknown> = {}) =>
    ({
      package: 'Succeed',
      custom_monthly_cost: undefined,
      pending_package: 'Achieve',
      pending_package_effective: '2026-09-01',
      ...over,
    }) as never;

  it('returns the current fields before the effective month', () => {
    expect(packageFieldsForMonth(pendingStudent(), 2026, 7).package).toBe(
      'Succeed',
    );
  });

  it('returns the pending fields in the effective month', () => {
    expect(packageFieldsForMonth(pendingStudent(), 2026, 8).package).toBe(
      'Achieve',
    );
  });

  it('returns the pending fields after the effective month (past-dated)', () => {
    expect(packageFieldsForMonth(pendingStudent(), 2027, 0).package).toBe(
      'Achieve',
    );
  });

  it('carries the pending CUSTOM overrides', () => {
    const fields = packageFieldsForMonth(
      pendingStudent({
        pending_package: 'Custom',
        pending_custom_monthly_cost: 500,
        pending_custom_sessions_per_week: 2,
        pending_custom_session_length_min: 45,
      }),
      2026,
      8,
    );
    expect(fields).toEqual({
      package: 'Custom',
      custom_monthly_cost: 500,
      custom_sessions_per_week: 2,
      custom_session_length_min: 45,
    });
  });

  it('ignores a pending package with no effective date', () => {
    expect(
      packageFieldsForMonth(
        pendingStudent({ pending_package_effective: undefined }),
        2026,
        8,
      ).package,
    ).toBe('Succeed');
  });

  it('is current-only for students with no pending change', () => {
    expect(
      packageFieldsForMonth(
        { package: 'Succeed', custom_monthly_cost: 1 } as never,
        2026,
        8,
      ),
    ).toEqual({
      package: 'Succeed',
      custom_monthly_cost: 1,
      custom_sessions_per_week: undefined,
      custom_session_length_min: undefined,
    });
  });
});

describe('studentMonthlyCharge with a scheduled package change', () => {
  const student = (over: Record<string, unknown> = {}) =>
    ({
      package: 'Succeed',
      package_start_date: '2026-01-01T00:00:00',
      pending_package: 'Achieve',
      pending_package_effective: '2026-09-01',
      ...over,
    }) as never;

  it('charges the old package before and the new from the effective month', () => {
    expect(studentMonthlyCharge(student(), 2026, 7, TEST_CATALOG)).toBe(362); // August
    expect(studentMonthlyCharge(student(), 2026, 8, TEST_CATALOG)).toBe(546); // September
  });

  it('handles a year-boundary effective date', () => {
    const s = student({ pending_package_effective: '2027-01-01' });
    expect(studentMonthlyCharge(s, 2026, 11, TEST_CATALOG)).toBe(362); // December
    expect(studentMonthlyCharge(s, 2027, 0, TEST_CATALOG)).toBe(546); // January
  });
});
