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
}

/** One student in a GROUP session's roster. */
export class SessionParticipant {
  id: string;
  name: string;
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
}
