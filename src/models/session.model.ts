export enum SessionType {
  TUTORING = 'TUTORING',
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
}
