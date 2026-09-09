import { PackageDef, perSessionCost, round2 } from './package-config';
import { ScheduleSlot } from '../models/student.model';

/**
 * Server-side mirror of the frontend proration helpers
 * (btctutoring-app/src/app/utils/proration.ts). Keep the two in sync.
 */

/** JS Date.getDay() (0=Sunday) → the stored weekday string. */
const WEEKDAY_BY_JS_DAY = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/**
 * Counts the schedule slots the student actually receives in their partial
 * first month: slots from the start date (inclusive) through month end.
 */
export function countRemainingSlots(
  schedule: ScheduleSlot[],
  startDate: Date,
): number {
  if (!schedule || schedule.length === 0) return 0;
  const weekdaysScheduled = schedule.map((s) => s.weekday);
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );
  const endOfMonth = new Date(
    startDate.getFullYear(),
    startDate.getMonth() + 1,
    0,
  );

  let remaining = 0;
  const cursor = new Date(start);
  while (cursor <= endOfMonth) {
    const weekday = WEEKDAY_BY_JS_DAY[cursor.getDay()];
    remaining += weekdaysScheduled.filter((w) => w === weekday).length;
    cursor.setDate(cursor.getDate() + 1);
  }
  return remaining;
}

/**
 * True when a start date misses none of the month's scheduled sessions — the
 * student receives every slot from the 1st through month end, so the month is
 * billed in full (client policy 2026-09: a start within the first week is a
 * full-month charge; the exact rule is "on or before the first scheduled
 * session"). Callers guard the empty-schedule case themselves.
 */
export function startMissesNoSlots(
  schedule: ScheduleSlot[],
  startDate: Date,
): boolean {
  const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  return (
    countRemainingSlots(schedule, startDate) ===
    countRemainingSlots(schedule, monthStart)
  );
}

/**
 * The prorated cost of a partial first month: per-session cost × the sessions
 * received (remaining slots), capped at the flat monthly cost (a month can
 * hold more weekly slots than the flat price covers).
 */
export function proratedFirstMonthCost(
  def: PackageDef,
  remainingSlots: number,
): number {
  return Math.min(
    def.monthlyCost,
    round2(perSessionCost(def) * remainingSlots),
  );
}

/** Splits a period total into two semi-monthly payments (the 2nd absorbs odd pennies). */
export function semiMonthlySplit(total: number): [number, number] {
  const first = round2(total / 2);
  const second = round2(total - first);
  return [first, second];
}
