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

/** Counts the schedule slots that fall before a mid-month start date. */
export function countMissedSlots(
  schedule: ScheduleSlot[],
  startDate: Date,
): number {
  if (!schedule || schedule.length === 0) return 0;
  const weekdaysScheduled = schedule.map((s) => s.weekday);
  const firstOfMonth = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    1,
  );
  const start = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  );

  let missed = 0;
  const cursor = new Date(firstOfMonth);
  while (cursor < start) {
    const weekday = WEEKDAY_BY_JS_DAY[cursor.getDay()];
    missed += weekdaysScheduled.filter((w) => w === weekday).length;
    cursor.setDate(cursor.getDate() + 1);
  }
  return missed;
}

/** The prorated cost of a partial first month; never below zero. */
export function proratedFirstMonthCost(
  def: PackageDef,
  missedSlots: number,
): number {
  const reduction = round2(perSessionCost(def) * missedSlots);
  return Math.max(0, round2(def.monthlyCost - reduction));
}

/** Splits a period total into two semi-monthly payments (the 2nd absorbs odd pennies). */
export function semiMonthlySplit(total: number): [number, number] {
  const first = round2(total / 2);
  const second = round2(total - first);
  return [first, second];
}
