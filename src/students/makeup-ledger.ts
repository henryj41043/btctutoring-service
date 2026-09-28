import { MakeupBatch, Student } from '../models/student.model';
import { dayAfterStartIso, keyOf } from '../billing/eastern-time';

/**
 * The make-up minute ledger (pure). Server-side twin of the app's
 * utils/makeup.ts — the app still needs its copy to SHOW balances, but every
 * attendance-driven change is calculated here, so a browser can no longer
 * write a balance of its own making. Keep the two in step.
 *
 * Nothing here mutates its input: each function returns a new student.
 */

/** Make-up minutes expire this many days after they're earned (unless overridden). */
export const MAKEUP_EXPIRY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LedgerResult {
  student: Student;
  /** Minutes that should have been taken but were no longer there. */
  unrecovered: number;
}

/** The instant the student's service ends (end of their last Eastern day), or null. */
export function serviceEndInstant(student: Student): Date | null {
  const key = keyOf(student.service_end_date);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const next = Date.parse(dayAfterStartIso(key));
  return isNaN(next) ? null : new Date(next - 1);
}

/** When a batch lapses on its own (null = never). Service end is handled apart. */
function naturalExpiry(batch: MakeupBatch, student: Student): number | null {
  if (student.make_up_never_expire) return null;
  return new Date(batch.earned_date).getTime() + MAKEUP_EXPIRY_DAYS * DAY_MS;
}

/**
 * True when a batch is past its 90-day life (never, if the student is
 * exempt) — or the student's service has ended: every remaining minute
 * expires with the last day of service, exempt or not.
 */
export function isExpired(
  batch: MakeupBatch,
  student: Student,
  now: Date,
): boolean {
  const end = serviceEndInstant(student);
  if (end && now.getTime() > end.getTime()) return true;
  const expiry = naturalExpiry(batch, student);
  return expiry !== null && expiry <= now.getTime();
}

/**
 * The stored batches as copies. A legacy student (pre-ledger) has only the
 * `make_up_minutes` scalar: it is folded into one batch dated now so it
 * isn't lost once batches exist.
 */
function ensureBatches(student: Student, now: Date): MakeupBatch[] {
  const stored = (student.make_up_batches ?? []).filter(
    (b) => !!b && typeof b.minutes === 'number' && !!b.earned_date,
  );
  if (stored.length > 0) return stored.map((b) => ({ ...b }));
  const legacy = student.make_up_minutes ?? 0;
  return legacy > 0
    ? [{ minutes: legacy, earned_date: now.toISOString() }]
    : [];
}

const oldestFirst = (a: MakeupBatch, b: MakeupBatch): number =>
  new Date(a.earned_date).getTime() - new Date(b.earned_date).getTime();

/** A copy of the student carrying the batches and the refreshed snapshot. */
function withBatches(student: Student, batches: MakeupBatch[]): Student {
  return {
    ...student,
    make_up_batches: batches,
    make_up_minutes: batches.reduce((sum, b) => sum + b.minutes, 0),
  };
}

/** The unexpired batches, as copies. */
function liveBatches(student: Student, now: Date): MakeupBatch[] {
  return ensureBatches(student, now).filter((b) => !isExpired(b, student, now));
}

/**
 * The student's currently-available make-up minutes: the sum of unexpired
 * batches, or (for a legacy record with no batches yet) the raw scalar.
 */
export function availableMakeupMinutes(
  student: Student,
  now: Date = new Date(),
): number {
  const batches = student.make_up_batches;
  if (!batches || batches.length === 0) {
    const end = serviceEndInstant(student);
    if (end && now.getTime() > end.getTime()) return 0;
    return student.make_up_minutes ?? 0;
  }
  return liveBatches(student, now).reduce((sum, b) => sum + b.minutes, 0);
}

/** Banks `minutes` as a new dated batch, pruning any that have since expired. */
export function bankMakeupMinutes(
  student: Student,
  minutes: number,
  earnedDateIso: string,
  now: Date = new Date(),
): Student {
  const batches = liveBatches(student, now);
  batches.push({ minutes, earned_date: earnedDateIso });
  return withBatches(student, batches);
}

/** Takes `minutes` from the batches given, oldest first; returns what is left to take. */
function takeFrom(
  batches: MakeupBatch[],
  minutes: number,
): { kept: MakeupBatch[]; remaining: number } {
  let remaining = minutes;
  const kept: MakeupBatch[] = [];
  for (const batch of [...batches].sort(oldestFirst)) {
    if (remaining <= 0) {
      kept.push(batch);
    } else if (batch.minutes <= remaining) {
      remaining -= batch.minutes; // whole batch consumed → dropped
    } else {
      kept.push({ ...batch, minutes: batch.minutes - remaining });
      remaining = 0;
    }
  }
  return { kept, remaining };
}

/**
 * Consumes `minutes` from the unexpired batches, oldest first (the minutes
 * closest to expiring go first). The balance never goes below zero: what
 * could not be taken is reported.
 */
export function consumeMakeupMinutes(
  student: Student,
  minutes: number,
  now: Date = new Date(),
): LedgerResult {
  const { kept, remaining } = takeFrom(liveBatches(student, now), minutes);
  return { student: withBatches(student, kept), unrecovered: remaining };
}

/**
 * Reverses a bank: removes the minutes a cancelled session earned (the batch
 * dated at that session's start). What is left of that batch goes first.
 * Minutes the student already USED are taken from their other batches,
 * oldest first — unless that batch has lapsed on its own by now, in which
 * case the missing minutes simply expired and nothing else is touched.
 */
export function unbankMakeupMinutes(
  student: Student,
  minutes: number,
  earnedDateIso: string,
  now: Date = new Date(),
): LedgerResult {
  const earned = new Date(earnedDateIso).getTime();
  const all = ensureBatches(student, now);
  const own = all.filter((b) => new Date(b.earned_date).getTime() === earned);
  const others = all.filter(
    (b) =>
      new Date(b.earned_date).getTime() !== earned &&
      !isExpired(b, student, now),
  );
  // The session's own minutes go whether or not they have expired.
  const fromOwn = takeFrom(own, minutes);
  const ownKept = fromOwn.kept.filter((b) => !isExpired(b, student, now));
  const lapsed = isExpired(
    { minutes, earned_date: earnedDateIso },
    student,
    now,
  );
  if (fromOwn.remaining <= 0 || lapsed) {
    return {
      student: withBatches(student, [...others, ...ownKept].sort(oldestFirst)),
      unrecovered: 0,
    };
  }
  const fromOthers = takeFrom(others, fromOwn.remaining);
  return {
    student: withBatches(
      student,
      [...fromOthers.kept, ...ownKept].sort(oldestFirst),
    ),
    unrecovered: fromOthers.remaining,
  };
}
