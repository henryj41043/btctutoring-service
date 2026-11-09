import { Session, SessionType } from '../models/session.model';
import { SESSION_STATUS } from './attendance';

/**
 * Double-booking guard (client 2026-11-04: the same make-up was booked twice
 * for one tutor and student). Pure: the caller loads the sessions around the
 * candidates' times and decides what to do with the hits.
 *
 * Rule (user decision 2026-11-04, hard block for everyone):
 * - Two sessions conflict when their times intersect and they share the
 *   tutor, or share a student (a GROUP session's participants count).
 * - Back-to-back is fine: a session ending at 10:45 does not conflict with
 *   one starting at 10:45.
 * - A Cancelled session holds no time; every other status does (Pending,
 *   Completed, No Call No Show). Admin Time counts: it is the tutor's time.
 */

/** One candidate that collides with a session already booked (or earlier in the same batch). */
export interface SessionConflict {
  /** Index of the candidate in the list checked. */
  index: number;
  /** The session it collides with: a stored one, or an earlier candidate (no id). */
  existing: Session;
  /** Whether the shared person is the tutor or a student. */
  shared: 'tutor' | 'student';
  /** Human sentence for the dialogs, e.g. "Emily Sentman already has a make-up with Graham Burdick from 10:00 AM to 10:45 AM on Thu, Oct 23." */
  message: string;
}

/** True when the session holds its time slot (any valid, non-cancelled session). */
export function holdsTime(session: Session): boolean {
  if (session.status === SESSION_STATUS.CANCELLED) return false;
  const start = Date.parse(session.start_datetime);
  const end = Date.parse(session.end_datetime);
  return !isNaN(start) && !isNaN(end) && end > start;
}

/** Every student a session books: its student plus a group's participants. */
export function studentIdsOf(session: Session): string[] {
  const ids = [
    session.student_id,
    ...(session.participants ?? []).map((p) => p?.id),
  ];
  return [...new Set(ids.filter((id): id is string => !!id))];
}

/** Half-open intervals [start, end): touching ends do not overlap. */
export function timesOverlap(a: Session, b: Session): boolean {
  return (
    Date.parse(a.start_datetime) < Date.parse(b.end_datetime) &&
    Date.parse(b.start_datetime) < Date.parse(a.end_datetime)
  );
}

/** How a session reads inside a sentence ("a make-up", "Admin Time"…). */
function typePhrase(type: string | undefined): string {
  switch (type) {
    case SessionType.MAKE_UP:
      return 'a make-up';
    case SessionType.ADMIN:
      return 'Admin Time';
    case SessionType.TRIAL:
      return 'a trial';
    case SessionType.CUSTOM_TRIAL:
      return 'a custom trial';
    case SessionType.GROUP:
      return 'a BTC & Me session';
    default:
      return 'a session';
  }
}

const TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});
const DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "from 10:00 AM to 10:45 AM on Thu, Oct 23" in Eastern time (the business's clock). */
export function slotPhrase(session: Session): string {
  const start = new Date(session.start_datetime);
  const end = new Date(session.end_datetime);
  return `from ${TIME.format(start)} to ${TIME.format(end)} on ${DAY.format(start)}`;
}

/** The sentence a dialog shows for one conflict. */
export function conflictMessage(
  candidate: Session,
  existing: Session,
  shared: 'tutor' | 'student',
): string {
  const what = typePhrase(existing.type);
  if (shared === 'tutor') {
    const tutor = existing.tutor_name || candidate.tutor_name || 'This tutor';
    const withWhom =
      existing.type === SessionType.GROUP
        ? ''
        : existing.student_name
          ? ` with ${existing.student_name}`
          : '';
    return `${tutor} already has ${what}${withWhom} ${slotPhrase(existing)}.`;
  }
  const student =
    existing.student_name || candidate.student_name || 'This student';
  const withWhom = existing.tutor_name ? ` with ${existing.tutor_name}` : '';
  return `${student} already has ${what}${withWhom} ${slotPhrase(existing)}.`;
}

/**
 * The candidates that collide with a booked session or with an EARLIER
 * candidate of the same list (a batch must not double-book itself). At most
 * one hit per candidate: the first booked session found, tutor clashes
 * before student clashes. `ignoreIds` leaves out the stored copy of a
 * session that is being edited.
 */
export function findConflicts(
  candidates: Session[],
  booked: Session[],
  ignoreIds: string[] = [],
): SessionConflict[] {
  const ignored = new Set(ignoreIds.filter(Boolean));
  const others = booked.filter(
    (s) => holdsTime(s) && !(s.id && ignored.has(s.id)),
  );
  const hits: SessionConflict[] = [];
  candidates.forEach((candidate, index) => {
    if (!holdsTime(candidate)) return;
    const earlier = candidates.slice(0, index).filter(holdsTime);
    const pool = [...others, ...earlier].filter((s) =>
      timesOverlap(candidate, s),
    );
    const tutorHit = candidate.tutor_id
      ? pool.find((s) => s.tutor_id === candidate.tutor_id)
      : undefined;
    if (tutorHit) {
      hits.push({
        index,
        existing: tutorHit,
        shared: 'tutor',
        message: conflictMessage(candidate, tutorHit, 'tutor'),
      });
      return;
    }
    const students = new Set(studentIdsOf(candidate));
    const studentHit =
      students.size > 0
        ? pool.find((s) => studentIdsOf(s).some((id) => students.has(id)))
        : undefined;
    if (studentHit) {
      hits.push({
        index,
        existing: studentHit,
        shared: 'student',
        message: conflictMessage(candidate, studentHit, 'student'),
      });
    }
  });
  return hits;
}

/**
 * The start_datetime window that can hold a session overlapping any of the
 * candidates: from a day before the earliest start (no session runs a full
 * day) to the latest end. Null when no candidate holds time.
 */
export function conflictWindow(
  candidates: Session[],
): { from: string; to: string } | null {
  const live = candidates.filter(holdsTime);
  if (live.length === 0) return null;
  const starts = live.map((s) => Date.parse(s.start_datetime));
  const ends = live.map((s) => Date.parse(s.end_datetime));
  const DAY_MS = 24 * 60 * 60 * 1000;
  return {
    from: new Date(Math.min(...starts) - DAY_MS).toISOString(),
    to: new Date(Math.max(...ends)).toISOString(),
  };
}

/** The 409 text for a list of hits: the one sentence, or a count plus the first few. */
export function conflictSummary(hits: SessionConflict[]): string {
  if (hits.length === 1) return hits[0].message;
  const shown = hits.slice(0, 3).map((h) => h.message);
  const more = hits.length > 3 ? ` (and ${hits.length - 3} more)` : '';
  return `${hits.length} sessions overlap sessions already booked. ${shown.join(' ')}${more}`;
}

/** The payload's defined fields only (an edit omits what it does not change). */
export function definedFields(payload: Partial<Session>): Partial<Session> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as Partial<Session>;
}

const sameTime = (a?: string, b?: string): boolean =>
  (a ?? '') === (b ?? '') || (!!a && !!b && Date.parse(a) === Date.parse(b));

/**
 * True when an edit moves the session's slot: a new time, tutor or set of
 * students, or a cancelled session put back on the calendar. Only those
 * edits are checked for double-booking.
 */
export function movesSlot(stored: Session, payload: Partial<Session>): boolean {
  const next = { ...stored, ...definedFields(payload) } as Session;
  const students = (s: Session) => studentIdsOf(s).sort().join(',');
  return (
    !sameTime(next.start_datetime, stored.start_datetime) ||
    !sameTime(next.end_datetime, stored.end_datetime) ||
    (next.tutor_id ?? '') !== (stored.tutor_id ?? '') ||
    students(next) !== students(stored) ||
    (!holdsTime(stored) && holdsTime(next))
  );
}
