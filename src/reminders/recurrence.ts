export type Recurrence = 'weekly' | 'monthly';

const DAY_MS = 86_400_000;
const fmt = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

/**
 * First occurrence of the series anchored at `anchor` that is STRICTLY after
 * `after`. All arguments are 'YYYY-MM-DD' wall dates. Weekly preserves the
 * anchor's day-of-week; monthly preserves its day-of-month with an
 * end-of-month clamp (Jan 31 -> Feb 28/29, Mar 31 -> Apr 30). Accepted drift:
 * once clamped, the smaller day becomes the new effective anchor day.
 *
 * Pure UTC millisecond math — deterministic regardless of host timezone/DST.
 */
export function nextOccurrence(
  anchor: string,
  recurrence: Recurrence,
  after: string,
): string {
  const [y, m, d] = anchor.split('-').map(Number);
  if (recurrence === 'weekly') {
    let t = Date.UTC(y, m - 1, d);
    do {
      t += 7 * DAY_MS;
    } while (fmt(t) <= after);
    return fmt(t);
  }
  for (let i = 1; ; i++) {
    const total = m - 1 + i;
    const nextYear = y + Math.floor(total / 12);
    const nextMonth = total % 12;
    const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
    const candidate = fmt(Date.UTC(nextYear, nextMonth, Math.min(d, lastDay)));
    if (candidate > after) {
      return candidate;
    }
  }
}
