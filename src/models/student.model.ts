export class ScheduleSlot {
  weekday: string;
  start_time: string; // 'HH:mm'
  end_time: string; // 'HH:mm'
  /** Optional per-slot tutor override; absent = the student's assigned (primary) tutor. */
  tutor_id?: string;
}

/**
 * One scheduled package change. `effective` ('YYYY-MM-01') is the key —
 * unique per student — so no synthetic id is needed.
 */
export class PendingChange {
  package: string;
  /** 'YYYY-MM-DD', always the 1st of a month. */
  effective: string;
  custom_monthly_cost?: number;
  custom_sessions_per_week?: number;
  custom_session_length_min?: number;
  /** The new package's weekly slots, swapped in at promotion (omitted when unset). */
  schedule?: ScheduleSlot[];
  /** The effective date this change's advance notice was sent for (cron-only writer). */
  notice_sent?: string;
}

/** A dated lot of remaining make-up minutes; expires 90 days after earned_date. */
export class MakeupBatch {
  minutes: number;
  earned_date: string; // ISO
}

export class Student {
  id?: string;
  contact_id: string;
  name: string;
  birthday: string;
  /** 'YYYY-MM-DD' trial-session date (per student; replaces contact.trial_date). */
  trial_date?: string;
  status: string;
  /** True once the student has finished onboarding; gates status/package/tutor/schedule edits. */
  onboarding_complete?: boolean;
  assigned_tutor_id: string;
  package: string;
  scholarship?: boolean;
  /** Enrolled in the "BTC & Me" group program — bills a flat monthly fee. */
  btc_and_me?: boolean;
  schedule?: ScheduleSlot[];
  package_start_date?: string;
  auto_renew?: boolean;
  custom_monthly_cost?: number;
  custom_sessions_per_week?: number;
  custom_session_length_min?: number;
  make_up_minutes: number;
  /** Dated lots of remaining make-up minutes (source of truth for the balance). */
  make_up_batches?: MakeupBatch[];
  /** When true, make-up minutes never expire. */
  make_up_never_expire?: boolean;
  /** Extra tutor planning minutes credited per counted session (payroll). */
  extra_planning_minutes?: number;
  /** Per-tutor overrides of extra_planning_minutes ([] on save = clear all). */
  extra_planning_by_tutor?: { tutor_id: string; minutes: number }[];
  /** Old package's prorated portion for a mid-month package change month. */
  mid_month_prior_charge?: number;
  /**
   * Scheduled package changes, oldest effective first; each is applied by
   * the 1st-of-month cron on its effective date ([] on save = clear all).
   */
  pending_changes?: PendingChange[];
  /** @deprecated Single-change scalars; read as a one-entry list, never written ('' = clear). */
  pending_package?: string;
  /** @deprecated See pending_changes. */
  pending_custom_monthly_cost?: number;
  /** @deprecated See pending_changes. */
  pending_custom_sessions_per_week?: number;
  /** @deprecated See pending_changes. */
  pending_custom_session_length_min?: number;
  /** @deprecated See pending_changes. */
  pending_package_effective?: string;
  /** @deprecated See pending_changes (notice_sent per entry). */
  pending_change_notice_sent?: string;
  /** @deprecated See pending_changes (schedule per entry). */
  pending_schedule?: ScheduleSlot[];
  /** The 'YYYY-MM' the mid_month_prior_charge applies to (that month only). */
  mid_month_change_period?: string;
  /** @deprecated Replaced by package-driven scheduling; retained for old records. */
  available_minutes?: number;
}
