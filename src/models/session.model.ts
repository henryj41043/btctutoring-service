export enum SessionType {
  TUTORING = 'TUTORING',
  MAKE_UP = 'MAKE_UP',
  ADMIN = 'ADMIN',
  /** 45-minute onboarding trial; payroll pays a flat hour (client policy). */
  TRIAL = 'TRIAL',
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
}
