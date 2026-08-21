/**
 * Explicit America/New_York wall-time → UTC conversion.
 *
 * Schedule slots store Eastern wall times ('HH:mm'). The auto-renew cron runs
 * on Fargate where the container clock is UTC, so ambient `setHours()` would
 * interpret slots in UTC and generate sessions 4-5 hours early (the July 2026
 * wrong-times bug). These helpers pin the interpretation to Eastern time,
 * DST-aware, regardless of the host's timezone.
 */

const EASTERN_TZ = 'America/New_York';

const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The Eastern-zone UTC offset (ms) in effect at the given instant (negative for EST/EDT). */
function easternOffsetMs(at: Date): number {
  const parts = easternParts.formatToParts(at);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some ICU builds render midnight as hour '24' with hour12:false.
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wall - at.getTime();
}

/**
 * The UTC instant at which an Eastern wall clock reads the given local time.
 * `month` is 0-indexed. The second offset pass settles DST-transition edges
 * (spring-forward/fall-back days), where the first guess can land on the wrong
 * side of the switch.
 */
export function easternWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month, day, hour, minute, 0, 0);
  let offset = easternOffsetMs(new Date(asUtc));
  offset = easternOffsetMs(new Date(asUtc - offset));
  return new Date(asUtc - offset);
}

const easternWallParts = new Intl.DateTimeFormat('en-US', {
  timeZone: EASTERN_TZ,
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * The Eastern wall-clock reading of a UTC instant: the stored weekday string
 * ('MONDAY'…) and slot time ('HH:mm'). Inverse of easternSlotToUtc — lets the
 * group-roll cron carry a session's wall time across months (and DST
 * transitions) without baking in a UTC offset.
 */
export function utcToEasternWall(at: Date): { weekday: string; time: string } {
  const parts = easternWallParts.formatToParts(at);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  // Some ICU builds render midnight as hour '24' with hour12:false.
  const hour = Number(get('hour')) % 24;
  const minute = get('minute').padStart(2, '0');
  return {
    weekday: get('weekday').toUpperCase(),
    time: `${String(hour).padStart(2, '0')}:${minute}`,
  };
}

/** The UTC instant for a schedule slot time ('HH:mm', Eastern) on a calendar date. */
export function easternSlotToUtc(
  year: number,
  month: number,
  day: number,
  time: string,
): Date {
  const [h, m] = (time ?? '').split(':').map(Number);
  return easternWallTimeToUtc(year, month, day, h || 0, m || 0);
}
