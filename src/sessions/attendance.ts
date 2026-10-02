import { Session, SessionType } from '../models/session.model';
import { Student } from '../models/student.model';
import {
  availableMakeupMinutes,
  bankMakeupMinutes,
  consumeMakeupMinutes,
  unbankMakeupMinutes,
} from '../students/makeup-ledger';

/**
 * Attendance rules (pure). Once a session's status leaves Pending it is
 * FINAL for the tutor; an admin may correct it, and every correction also
 * corrects the student's make-up minutes.
 */

export const SESSION_STATUS = {
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_CALL_NO_SHOW: 'NCNS',
} as const;

export const SESSION_STATUSES: string[] = Object.values(SESSION_STATUS);

export const ATTENDANCE_FINAL_MESSAGE =
  'Attendance is final. Ask an admin to correct it.';

/** True once attendance has been taken. */
export function isFinalized(status: string | undefined): boolean {
  return !!status && status !== SESSION_STATUS.PENDING;
}

export type AttendanceEffect = 'bank' | 'consume' | null;

/**
 * What a status does to the student's make-up minutes: a cancelled tutoring
 * session BANKS its length; a make-up that was held (or a no-show) CONSUMES
 * its length. Trials, custom trials, BTC & Me and admin sessions never touch
 * the bank: a custom trial is not billed, so there is nothing to make up.
 */
export function attendanceEffect(
  type: SessionType | string | undefined,
  status: string | undefined,
): AttendanceEffect {
  if (type === SessionType.TUTORING) {
    return status === SESSION_STATUS.CANCELLED ? 'bank' : null;
  }
  if (type === SessionType.MAKE_UP) {
    return status === SESSION_STATUS.COMPLETED ||
      status === SESSION_STATUS.NO_CALL_NO_SHOW
      ? 'consume'
      : null;
  }
  return null;
}

/** The session's length in whole minutes (0 when the times are unusable). */
export function sessionMinutes(session: Session): number {
  const start = new Date(session.start_datetime).getTime();
  const end = new Date(session.end_datetime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export interface AttendancePlan {
  /** The student with the corrected ledger; absent when nothing changes. */
  student?: Student;
  before: number;
  after: number;
  delta: number;
  /** Minutes that should have been taken but were no longer there. */
  unrecovered: number;
}

/**
 * The make-up minute change of moving a session to `newStatus`: the stored
 * status's effect is reversed, then the new status's effect is applied.
 */
export function planAttendanceChange(
  session: Session,
  newStatus: string,
  student: Student | undefined,
  now: Date = new Date(),
): AttendancePlan {
  const before = student ? availableMakeupMinutes(student, now) : 0;
  const unchanged: AttendancePlan = {
    before,
    after: before,
    delta: 0,
    unrecovered: 0,
  };
  if (!student) return unchanged;
  const oldEffect = attendanceEffect(session.type, session.status);
  const newEffect = attendanceEffect(session.type, newStatus);
  const minutes = sessionMinutes(session);
  if (oldEffect === newEffect || minutes === 0) return unchanged;

  let ledger = student;
  let unrecovered = 0;
  if (oldEffect === 'bank') {
    const reversed = unbankMakeupMinutes(
      ledger,
      minutes,
      session.start_datetime,
      now,
    );
    ledger = reversed.student;
    unrecovered += reversed.unrecovered;
  } else if (oldEffect === 'consume') {
    // Refunded as a new batch dated at the session.
    ledger = bankMakeupMinutes(ledger, minutes, session.start_datetime, now);
  }
  if (newEffect === 'bank') {
    ledger = bankMakeupMinutes(ledger, minutes, session.start_datetime, now);
  } else if (newEffect === 'consume') {
    const consumed = consumeMakeupMinutes(ledger, minutes, now);
    ledger = consumed.student;
    unrecovered += consumed.unrecovered;
  }
  const after = availableMakeupMinutes(ledger, now);
  return {
    student: ledger,
    before,
    after,
    delta: after - before,
    unrecovered,
  };
}

const sameInstant = (a: string | undefined, b: string | undefined): boolean => {
  if (a === b) return true;
  const left = new Date(a ?? '').getTime();
  const right = new Date(b ?? '').getTime();
  return !isNaN(left) && left === right;
};

const rosterOf = (session: Partial<Session>): string =>
  (session.participants ?? [])
    .map((p) => p?.id ?? '')
    .sort()
    .join(',');

/**
 * The frozen fields of a finalized session that a payload tries to change.
 * Notes are never frozen.
 */
export function lockedFieldChanges(
  stored: Session,
  payload: Partial<Session>,
): string[] {
  const changed: string[] = [];
  if ((payload.status ?? '') !== (stored.status ?? '')) changed.push('status');
  if ((payload.type ?? '') !== (stored.type ?? '')) changed.push('type');
  if (!sameInstant(payload.start_datetime, stored.start_datetime)) {
    changed.push('start_datetime');
  }
  if (!sameInstant(payload.end_datetime, stored.end_datetime)) {
    changed.push('end_datetime');
  }
  if ((payload.student_id ?? '') !== (stored.student_id ?? '')) {
    changed.push('student_id');
  }
  if ((payload.tutor_id ?? '') !== (stored.tutor_id ?? '')) {
    changed.push('tutor_id');
  }
  if (rosterOf(payload) !== rosterOf(stored)) changed.push('participants');
  return changed;
}
