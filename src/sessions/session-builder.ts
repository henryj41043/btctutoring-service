import { randomUUID } from 'crypto';
import { Session, SessionType } from '../models/session.model';
import { ScheduleSlot, Student } from '../models/student.model';
import { easternSlotToUtc, utcToEasternWall } from '../billing/eastern-time';
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

const dayKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

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
      if (input.notAfter && dayKey(year, month, day) > input.notAfter) continue;
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

/**
 * The slots that govern a month: the last scheduled package change effective
 * on or before the month start wins — its own schedule when one was set,
 * otherwise `null` (the month must stay EMPTY until an admin sets the
 * schedule or the 1st-of-month promotion applies its fallback). With no
 * governing change the student's current schedule applies.
 */
export function governingSlotsForMonth(
  student: Student,
  monthStartKey: string,
): ScheduleSlot[] | null {
  const reached = pendingChangesOf(student).filter(
    (c) => c.effective <= monthStartKey,
  );
  const governing = reached[reached.length - 1];
  if (!governing) return student.schedule ?? [];
  return governing.schedule?.length ? governing.schedule : null;
}
