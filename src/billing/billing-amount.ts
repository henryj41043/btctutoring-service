import { Student } from '../models/student.model';
import { PackageDef, resolvePackageDef, round2 } from './package-config';
import { countRemainingSlots, proratedFirstMonthCost } from './proration';

/** A month key 'YYYY-MM' (month is 0-indexed) — the mid-month-change tag format. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * The old package's prorated portion to add on top of the new package's charge,
 * but only in the month the mid-month package change happened.
 */
export function midMonthAdjustment(
  student: Student,
  year: number,
  month: number,
): number {
  if (
    student.mid_month_change_period === monthKey(year, month) &&
    student.mid_month_prior_charge
  ) {
    return student.mid_month_prior_charge;
  }
  return 0;
}

/** The package charge before any mid-month adjustment. */
function baseMonthlyCharge(
  def: PackageDef,
  student: Student,
  year: number,
  month: number,
): number {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  if (!student.package_start_date) {
    return def.monthlyCost;
  }

  const start = new Date(student.package_start_date);
  if (start > monthEnd) return 0;
  if (start >= monthStart && start <= monthEnd && start.getDate() > 1) {
    // Without a schedule the remaining slots can't be counted — fall back to
    // the full monthly cost rather than silently billing $0.
    const schedule = student.schedule ?? [];
    if (schedule.length === 0) return def.monthlyCost;
    return proratedFirstMonthCost(def, countRemainingSlots(schedule, start));
  }
  return def.monthlyCost;
}

/**
 * Server-side mirror of the frontend billing-amount helper
 * (btctutoring-app/src/app/utils/billing-amount.ts). The amount to charge a
 * student for a given billing month (`month` is 0-indexed). Includes the
 * mid-month package-change adjustment (old package's portion for that month).
 */
export function studentMonthlyCharge(
  student: Student,
  year: number,
  month: number,
): number {
  const def = resolvePackageDef(student.package, {
    monthlyCost: student.custom_monthly_cost,
    sessionsPerWeek: student.custom_sessions_per_week,
    sessionLengthMin: student.custom_session_length_min,
  });
  if (!def) return 0;

  const base = baseMonthlyCharge(def, student, year, month);
  return round2(base + midMonthAdjustment(student, year, month));
}

/**
 * Applies the family's sibling discount to a contact's total, but only when the
 * family actually has 2+ enrolled students. A stale percent never discounts an
 * only child.
 */
export function siblingDiscountedTotal(
  total: number,
  percent: number | undefined,
  enrolledStudentCount: number,
): number {
  if (!percent || percent <= 0 || enrolledStudentCount < 2) {
    return total;
  }
  const pct = Math.min(100, Math.max(0, percent));
  return round2(total * (1 - pct / 100));
}
