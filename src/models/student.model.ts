export class ScheduleSlot {
  weekday: string;
  start_time: string; // 'HH:mm'
  end_time: string; // 'HH:mm'
}

export class Student {
  id?: string;
  contact_id: string;
  name: string;
  birthday: string;
  status: string;
  assigned_tutor_id: string;
  package: string;
  scholarship?: boolean;
  schedule?: ScheduleSlot[];
  package_start_date?: string;
  auto_renew?: boolean;
  custom_monthly_cost?: number;
  custom_sessions_per_week?: number;
  custom_session_length_min?: number;
  make_up_minutes: number;
  /** @deprecated Replaced by package-driven scheduling; retained for old records. */
  available_minutes?: number;
}
