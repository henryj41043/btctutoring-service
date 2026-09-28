import { randomUUID } from 'crypto';
import { Session, SessionType } from '../models/session.model';
import { ScheduleSlot, Student } from '../models/student.model';
import {
  dateKey,
  dayBefore,
  easternSlotToUtc,
  keyOf,
  lastDayOfMonth,
  utcToEasternWall,
} from '../billing/eastern-time';
import { pendingChangesOf } from '../students/pending-changes';

/**
 * Pure session generators shared by the 1st-of-month auto-renew run and the
 * daily horizon fill (no Nest deps). Slot times are Eastern wall times and
 * the container clock is UTC, so every instant goes through easternSlotToUtc.
 */

/** Months generated ahead of the current one (client policy 2026-09). */
export const HORIZON_MONTHS_AHEAD = 3;
/** BTC & Me sessions are always exactly 45 minutes (client policy). */
export const GROUP_SESSION_MINUTES = 45;
export const PENDING_STATUS = 'Pending';
/** JS Date.getDay() (0=Sunday) → the stored weekday string. */
export const WEEKDAY_BY_JS_DAY = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export interface TutoringMonthInput {
  student: Student;
  /** The slots governing this month (current schedule or a pending change's). */
  slots: ScheduleSlot[];
  tutorNameById: (id: string) => string | undefined;
  year: number;
  /** 0-indexed; overflow (e.g. 12) is normalised by Date. */
  month: number;
  /** Calendar days before this local date are skipped (package start month). */
  notBefore?: Date;
  /** 'YYYY-MM-DD': calendar days after this date are skipped (service end date). */
  notAfter?: string;
  /** Existing series id per effective tutor — reused so "this and future"
   *  edits stay continuous across month boundaries; minted when absent. */
  seriesIdByTutor?: Map<string, string>;
}

/** Normalises a possibly-overflowed (year, month) pair. */
export function normalizeMonth(
  year: number,
  month: number,
): { year: number; month: number } {
  const d = new Date(year, month, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * One month of PENDING tutoring sessions for a student's slots: one series per
 * EFFECTIVE tutor (slot override or the assigned tutor), so series-scoped
 * edits/deletes never touch another tutor's sessions.
 */
export function buildTutoringMonthSessions(
  input: TutoringMonthInput,
): Session[] {
  const { student, slots, tutorNameById, notBefore, seriesIdByTutor } = input;
  const { year, month } = normalizeMonth(input.year, input.month);
  const sessions: Session[] = [];
  const byTutor = new Map<string, { seriesId: string; name: string }>();
  const tutorEntry = (tutorId: string) => {
    let entry = byTutor.get(tutorId);
    if (!entry) {
      entry = {
        seriesId: seriesIdByTutor?.get(tutorId) ?? randomUUID(),
        name: tutorNameById(tutorId) ?? '',
      };
      byTutor.set(tutorId, entry);
    }
    return entry;
  };
  const cutoff = notBefore
    ? new Date(
        notBefore.getFullYear(),
        notBefore.getMonth(),
        notBefore.getDate(),
      )
    : null;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (const slot of slots) {
    const effTutorId = slot.tutor_id ?? student.assigned_tutor_id;
    const entry = tutorEntry(effTutorId);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      if (WEEKDAY_BY_JS_DAY[date.getDay()] !== slot.weekday) continue;
      if (cutoff && date < cutoff) continue;
      if (input.notAfter && dateKey(year, month, day) > input.notAfter)
        continue;
      sessions.push({
        type: SessionType.TUTORING,
        start_datetime: easternSlotToUtc(
          year,
          month,
          day,
          slot.start_time,
        ).toISOString(),
        end_datetime: easternSlotToUtc(
          year,
          month,
          day,
          slot.end_time,
        ).toISOString(),
        status: PENDING_STATUS,
        notes: '',
        student_id: student.id,
        student_name: student.name,
        tutor_id: effTutorId,
        tutor_name: entry.name,
        series_id: entry.seriesId,
      } as Session);
    }
  }
  return sessions;
}

/**
 * One month of weekly occurrences for a "BTC & Me" group series, copying
 * tutor/roster from its latest occurrence. The Eastern wall time is carried
 * (not the UTC offset), so a 5pm series stays at 5pm across the DST switch.
 */
export function buildGroupRollSessions(
  latest: Session,
  inputYear: number,
  inputMonth: number,
): Session[] {
  const { year, month } = normalizeMonth(inputYear, inputMonth);
  const wall = utcToEasternWall(new Date(latest.start_datetime));
  const sessions: Session[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    if (WEEKDAY_BY_JS_DAY[date.getDay()] !== wall.weekday) continue;
    const start = easternSlotToUtc(year, month, day, wall.time);
    sessions.push({
      type: SessionType.GROUP,
      start_datetime: start.toISOString(),
      end_datetime: new Date(
        start.getTime() + GROUP_SESSION_MINUTES * 60000,
      ).toISOString(),
      status: PENDING_STATUS,
      notes: '',
      student_name: latest.student_name,
      tutor_id: latest.tutor_id,
      tutor_name: latest.tutor_name,
      series_id: latest.series_id,
      participants: latest.participants,
    } as Session);
  }
  return sessions;
}

/** A stretch of one month governed by one weekly schedule (both days inclusive). */
export interface ScheduleSegment {
  /** null = a scheduled change with no schedule yet: the stretch stays EMPTY. */
  slots: ScheduleSlot[] | null;
  from: string; // 'YYYY-MM-DD'
  to: string; // 'YYYY-MM-DD'
}

/**
 * The schedule stretches of one month, oldest first: the student's current
 * schedule from its start date until the day before the first scheduled
 * change, then each change from its effective date until the day before
 * the next. Everything is clipped to the month and to the service end date.
 * A change with its own schedule switches the slots ON its effective date;
 * one without leaves its stretch empty until an admin sets the schedule or
 * the change is promoted (the old schedule then carries on).
 */
export function scheduleSegmentsForMonth(
  student: Student,
  inputYear: number,
  inputMonth: number,
): ScheduleSegment[] {
  const { year, month } = normalizeMonth(inputYear, inputMonth);
  const monthStart = dateKey(year, month, 1);
  const monthEnd = lastDayOfMonth(year, month);
  const serviceEnd = keyOf(student.service_end_date);
  const changes = pendingChangesOf(student);

  const stretches: {
    slots: ScheduleSlot[] | null;
    start?: string;
    end?: string;
  }[] = [];
  stretches.push({
    slots: student.schedule ?? [],
    start: keyOf(student.package_start_date),
    end: changes[0] ? dayBefore(changes[0].effective.slice(0, 10)) : undefined,
  });
  changes.forEach((change, i) => {
    const next = changes[i + 1];
    stretches.push({
      slots: change.schedule?.length ? change.schedule : null,
      start: change.effective.slice(0, 10),
      end: next ? dayBefore(next.effective.slice(0, 10)) : undefined,
    });
  });

  const segments: ScheduleSegment[] = [];
  for (const stretch of stretches) {
    const from =
      stretch.start && stretch.start > monthStart ? stretch.start : monthStart;
    let to = stretch.end && stretch.end < monthEnd ? stretch.end : monthEnd;
    if (serviceEnd && serviceEnd < to) to = serviceEnd;
    if (from > to) continue;
    segments.push({ slots: stretch.slots, from, to });
  }
  return segments;
}

/** A 'YYYY-MM-DD' key as a local Date (for notBefore). */
function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** One segment's PENDING tutoring sessions (nothing for an empty stretch). */
export function buildTutoringSegmentSessions(
  segment: ScheduleSegment,
  input: Omit<TutoringMonthInput, 'slots' | 'notBefore' | 'notAfter'>,
): Session[] {
  if (!segment.slots || segment.slots.length === 0) return [];
  return buildTutoringMonthSessions({
    ...input,
    slots: segment.slots,
    notBefore: localDate(segment.from),
    notAfter: segment.to,
  });
}
