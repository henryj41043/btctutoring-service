import { PendingChange, ScheduleSlot, Student } from '../models/student.model';

/**
 * The single-change scalar fields that `pending_changes` replaced. Still
 * READ (a leftover record is treated as a one-entry list) but never written;
 * every pending write $REMOVEs them so a record converges on the list.
 */
export const LEGACY_PENDING_FIELDS = [
  'pending_package',
  'pending_custom_monthly_cost',
  'pending_custom_sessions_per_week',
  'pending_custom_session_length_min',
  'pending_package_effective',
  'pending_schedule',
  'pending_change_notice_sent',
] as const;

const byEffective = (a: PendingChange, b: PendingChange): number =>
  a.effective < b.effective ? -1 : a.effective > b.effective ? 1 : 0;

const cleanSlots = (raw: unknown): ScheduleSlot[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const slots = raw.filter(
    (s): s is ScheduleSlot => !!s && typeof s === 'object',
  );
  return slots.length > 0 ? slots : undefined;
};

/**
 * The student's scheduled package changes, oldest effective first. Reads the
 * list when present, else folds a legacy single change into a one-entry list.
 * Always a fresh array — never the stored reference.
 */
export function pendingChangesOf(student: Student): PendingChange[] {
  if (Array.isArray(student.pending_changes)) {
    return student.pending_changes
      .filter(
        (c): c is PendingChange =>
          !!c &&
          typeof c === 'object' &&
          typeof c.package === 'string' &&
          !!c.package &&
          typeof c.effective === 'string' &&
          !!c.effective,
      )
      .map((c) => ({ ...c }))
      .sort(byEffective);
  }
  if (student.pending_package && student.pending_package_effective) {
    const legacy: PendingChange = {
      package: student.pending_package,
      effective: student.pending_package_effective,
    };
    if (student.pending_custom_monthly_cost !== undefined) {
      legacy.custom_monthly_cost = student.pending_custom_monthly_cost;
    }
    if (student.pending_custom_sessions_per_week !== undefined) {
      legacy.custom_sessions_per_week =
        student.pending_custom_sessions_per_week;
    }
    if (student.pending_custom_session_length_min !== undefined) {
      legacy.custom_session_length_min =
        student.pending_custom_session_length_min;
    }
    const schedule = cleanSlots(student.pending_schedule);
    if (schedule) legacy.schedule = schedule;
    if (student.pending_change_notice_sent) {
      legacy.notice_sent = student.pending_change_notice_sent;
    }
    return [legacy];
  }
  return [];
}

const NUMBER_KEYS = [
  'custom_monthly_cost',
  'custom_sessions_per_week',
  'custom_session_length_min',
] as const;

/**
 * Write-path scrub of a client-supplied list: known keys only, no nested
 * null/undefined (dynamoose rejects them inside arrays — the top-level strip
 * in buildStudentAttributes never reaches this deep), malformed slots dropped,
 * an empty schedule omitted, sorted by effective. Entries without a package or
 * effective date are dropped.
 */
export function sanitizePendingChanges(raw: unknown[]): PendingChange[] {
  const clean: PendingChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.package !== 'string' ||
      !entry.package ||
      typeof entry.effective !== 'string' ||
      !entry.effective
    ) {
      continue;
    }
    const change: PendingChange = {
      package: entry.package,
      effective: entry.effective,
    };
    for (const key of NUMBER_KEYS) {
      if (typeof entry[key] === 'number' && Number.isFinite(entry[key])) {
        change[key] = entry[key];
      }
    }
    const schedule = cleanSlots(entry.schedule);
    if (schedule) change.schedule = schedule;
    if (typeof entry.notice_sent === 'string' && entry.notice_sent) {
      change.notice_sent = entry.notice_sent;
    }
    clean.push(change);
  }
  return clean.sort(byEffective);
}

/** What the 1st-of-month cron applies for one student in one run. */
export interface PromotionPlan {
  /** Every change whose effective date has arrived, oldest first. */
  due: PendingChange[];
  /** Changes still in the future — written back as the new list. */
  remaining: PendingChange[];
  /** The last due change: its package (and overrides) become current. */
  last: PendingChange;
  /** The last due change that carries a schedule — those slots go live. */
  schedule?: ScheduleSlot[];
}

/**
 * Splits the student's changes at the run month: everything with
 * `effective <= monthStartKey` ('YYYY-MM-01') is due — including past-dated
 * entries a downed cron missed. Null when nothing is due.
 */
export function planPromotion(
  student: Student,
  monthStartKey: string,
): PromotionPlan | null {
  const changes = pendingChangesOf(student);
  const due = changes.filter((c) => c.effective <= monthStartKey);
  if (due.length === 0) return null;
  const remaining = changes.filter((c) => c.effective > monthStartKey);
  const withSchedule = [...due]
    .reverse()
    .find((c) => c.schedule && c.schedule.length > 0);
  const plan: PromotionPlan = {
    due,
    remaining,
    last: due[due.length - 1],
  };
  if (withSchedule) plan.schedule = withSchedule.schedule;
  return plan;
}

/** A copy of the list with the matching entry stamped as announced. */
export function withNoticeSent(
  changes: PendingChange[],
  effective: string,
): PendingChange[] {
  return changes.map((c) =>
    c.effective === effective ? { ...c, notice_sent: effective } : { ...c },
  );
}
