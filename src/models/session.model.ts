export enum SessionType {
  TUTORING = 'TUTORING',
  MAKE_UP = 'MAKE_UP',
  ADMIN = 'ADMIN',
  /** 45-minute onboarding trial; payroll pays a flat hour (client policy). */
  TRIAL = 'TRIAL',
  /**
   * "BTC & Me" 45-minute weekly group session: one tutor, many students
   * (participants). Payroll pays a flat hour; billing is a flat monthly fee
   * per enrolled student (student.btc_and_me); never touches make-up banks.
   */
  GROUP = 'GROUP',
  /**
   * A one-off session for an ACTIVE student (client 2026-10-02), usually to
   * try a different tutor. Unlike the onboarding TRIAL it is paid exactly
   * like a tutoring session (its real length, with planning). The parent is
   * never billed, so a cancelled one banks no make-up minutes. Admins only.
   */
  CUSTOM_TRIAL = 'CUSTOM_TRIAL',
}

/** One student in a GROUP session's roster. */
export class SessionParticipant {
  id: string;
  name: string;
}

/** One attendance change on a session (who, when, why, and the minutes moved). */
export class AttendanceChange {
  from: string;
  to: string;
  /** The contact id of whoever made the change. */
  by: string;
  by_name?: string;
  at: string;
  /** Required when an admin corrects attendance that was already taken. */
  reason?: string;
  /** The change in the student's available make-up minutes. */
  minutes_delta?: number;
  /** Minutes that should have been taken back but were already gone. */
  unrecovered?: number;
}

export class Session {
  id?: string;
  type: SessionType;
  end_datetime: string;
  notes: string;
  start_datetime: string;
  status: string;
  student_id?: string;
  student_name?: string;
  tutor_id: string;
  tutor_name: string;
  series_id?: string;
  /** Last time the notes were emailed to the parent (re-sends allowed). */
  notes_emailed_at?: string;
  /** GROUP sessions only: the student roster (student_id stays empty). */
  participants?: SessionParticipant[];
  /** Every attendance change, oldest first (written by setAttendance only). */
  attendance_history?: AttendanceChange[];
}
