/**
 * Billing weeks (client rule 2026-10-13): weeks run Sunday to Saturday, and
 * a week that straddles a month end belongs ENTIRELY to the month holding
 * the majority of its seven days. The majority month is the month of the
 * week's Wednesday (Sunday + 3): four or more days fall in it by definition.
 *
 * Pure date-key arithmetic ('YYYY-MM-DD', UTC): no zones, no DST drift.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (key: string): Date => new Date(`${key}T00:00:00Z`);
const toKey = (date: Date): string => date.toISOString().slice(0, 10);

/** 'YYYY-MM-DD' + n days. */
export function addDays(key: string, days: number): string {
  return toKey(new Date(toDate(key).getTime() + days * DAY_MS));
}

/** The Sunday and Saturday of the week holding a date. */
export function weekOf(key: string): { sunday: string; saturday: string } {
  const sunday = addDays(key, -toDate(key).getUTCDay());
  return { sunday, saturday: addDays(sunday, 6) };
}

/** 'YYYY-MM' of the month a date's week belongs to (its Wednesday's month). */
export function billingMonthOf(key: string): string {
  return addDays(weekOf(key).sunday, 3).slice(0, 7);
}

/**
 * The dates a month's statement covers: the Sunday of its first week through
 * the Saturday of its last. `month` is 0-indexed, as everywhere in billing.
 * Sept 2026 = Aug 30 → Oct 3; Oct = Oct 4 → Oct 31; Dec = Nov 29 → Jan 2.
 */
export function billingSpan(
  year: number,
  month: number,
): { from: string; to: string } {
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const first = `${monthKey}-01`;
  const last = toKey(new Date(Date.UTC(year, month + 1, 0)));
  const firstWeek = weekOf(first);
  const lastWeek = weekOf(last);
  return {
    from:
      billingMonthOf(first) === monthKey
        ? firstWeek.sunday
        : addDays(firstWeek.sunday, 7),
    to:
      billingMonthOf(last) === monthKey
        ? lastWeek.saturday
        : addDays(lastWeek.saturday, -7),
  };
}
