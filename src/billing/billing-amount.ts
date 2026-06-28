import { Student } from '../models/student.model';
import { resolvePackageDef } from './package-config';
import { countMissedSlots, proratedFirstMonthCost } from './proration';

/**
 * Server-side mirror of the frontend billing-amount helper
 * (btctutoring-app/src/app/utils/billing-amount.ts). The amount to charge a
 * student for a given billing month (`month` is 0-indexed).
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

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);

  if (!student.package_start_date) {
    return def.monthlyCost;
  }

  const start = new Date(student.package_start_date);
  if (start > monthEnd) return 0;
  if (start >= monthStart && start <= monthEnd && start.getDate() > 1) {
    return proratedFirstMonthCost(
      def,
      countMissedSlots(student.schedule ?? [], start),
    );
  }
  return def.monthlyCost;
}
