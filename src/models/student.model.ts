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
  /** True once the student has finished onboarding; gates status/package/tutor/schedule edits. */
  onboarding_complete?: boolean;
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
  /** Old package's prorated portion for a mid-month package change month. */
  mid_month_prior_charge?: number;
  /** The 'YYYY-MM' the mid_month_prior_charge applies to (that month only). */
  mid_month_change_period?: string;
  /** @deprecated Replaced by package-driven scheduling; retained for old records. */
  available_minutes?: number;
}
