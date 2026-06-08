export enum SessionType {
  TUTORING = 'TUTORING',
  MAKE_UP = 'MAKE_UP',
  ADMIN = 'ADMIN',
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
}
