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

/** Flat monthly fee per student enrolled in the "BTC & Me" group program. */
export const GROUP_MONTHLY_FEE = 75;

/**
 * The family's flat "BTC & Me" total: $75 per enrolled (btc_and_me) student.
 * Charged in full regardless of attendance or mid-month enrollment (client
 * policy), and never sibling-discounted — add it AFTER the discount. Callers
 * pass students already filtered to Active.
 */
export function groupSessionFee(students: Student[]): number {
  return GROUP_MONTHLY_FEE * students.filter((s) => s.btc_and_me).length;
}

/**
 * Applies the family's sibling discount to a contact's total, but only when the
 * family actually has 3+ enrolled students (per the client's policy). A stale
 * percent never discounts a smaller family.
 */
export function siblingDiscountedTotal(
  total: number,
  percent: number | undefined,
  enrolledStudentCount: number,
): number {
  if (!percent || percent <= 0 || enrolledStudentCount < 3) {
    return total;
  }
  const pct = Math.min(100, Math.max(0, percent));
  return round2(total * (1 - pct / 100));
}
