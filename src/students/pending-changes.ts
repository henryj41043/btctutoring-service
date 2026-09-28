import {
  PackageSegment,
  PendingChange,
  ScheduleSlot,
  Student,
} from '../models/student.model';
import { dayBefore, keyOf } from '../billing/eastern-time';

/** Mirrors billing/package-config (kept local: this module has no billing deps beyond dates). */
const CUSTOM = 'Custom';
/** The start recorded for a segment whose student never had a start date. */
export const UNKNOWN_START = '1970-01-01';

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
    if (isPrice(entry.price_override)) {
      change.price_override = entry.price_override;
    }
    clean.push(change);
  }
  return clean.sort(byEffective);
}

const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** What a promotion run applies for one student. */
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

/** What a promotion writes, and the student as it stands afterwards. */
export interface PromotionResult {
  promoted: Student;
  sets: Record<string, unknown>;
  removes: string[];
}

/** A history segment without undefined/null/empty members (dynamoose rejects them nested). */
function segmentOf(fields: PackageSegment): PackageSegment {
  const segment: PackageSegment = {
    package: fields.package,
    start: fields.start,
    end: fields.end,
  };
  if (fields.package === CUSTOM) {
    for (const key of NUMBER_KEYS) {
      if (typeof fields[key] === 'number') segment[key] = fields[key];
    }
  }
  if (isPrice(fields.price_override)) {
    segment.price_override = fields.price_override;
  }
  if (typeof fields.discount_percent === 'number' && fields.discount_percent) {
    segment.discount_percent = fields.discount_percent;
  }
  const schedule = cleanSlots(fields.schedule);
  if (schedule) segment.schedule = schedule;
  const firstWeek = (fields.first_week_sessions ?? []).filter(
    (s) => !!s && typeof s === 'object',
  );
  if (firstWeek.length > 0) segment.first_week_sessions = firstWeek;
  return segment;
}

/**
 * Applies every scheduled change due on or before `dayKey` ('YYYY-MM-DD'):
 * the package the student was on (and any due change that was itself
 * superseded) is closed into `package_history`, so past months keep billing
 * what they were; the LAST due change becomes current. A custom price
 * resets unless the change carries its own. Null when nothing is due.
 */
export function applyPromotion(
  student: Student,
  dayKey: string,
): PromotionResult | null {
  const plan = planPromotion(student, dayKey);
  if (!plan) return null;

  const history: PackageSegment[] = (student.package_history ?? [])
    .filter((h) => !!h && !!h.package && !!h.start && !!h.end)
    .map((h) => segmentOf(h));
  const push = (segment: PackageSegment): void => {
    // A segment that ends before it starts never ran (corrupt dates).
    if (segment.start <= segment.end) history.push(segmentOf(segment));
  };
  const effectiveOf = (c: PendingChange): string => c.effective.slice(0, 10);

  let schedule = student.schedule;
  if (student.package) {
    push({
      package: student.package,
      start: keyOf(student.package_start_date) ?? UNKNOWN_START,
      end: dayBefore(effectiveOf(plan.due[0])),
      custom_monthly_cost: student.custom_monthly_cost,
      custom_sessions_per_week: student.custom_sessions_per_week,
      custom_session_length_min: student.custom_session_length_min,
      price_override: student.price_override ?? undefined,
      discount_percent: student.discount_percent ?? undefined,
      schedule,
      first_week_sessions: student.first_week_sessions,
    });
  }
  plan.due.forEach((change, i) => {
    if (change.schedule && change.schedule.length > 0) {
      schedule = change.schedule;
    }
    const next = plan.due[i + 1];
    if (!next) return;
    push({
      package: change.package,
      start: effectiveOf(change),
      end: dayBefore(effectiveOf(next)),
      custom_monthly_cost: change.custom_monthly_cost,
      custom_sessions_per_week: change.custom_sessions_per_week,
      custom_session_length_min: change.custom_session_length_min,
      price_override: change.price_override,
      discount_percent: student.discount_percent ?? undefined,
      schedule,
    });
  });

  const last = plan.last;
  const isCustom = last.package === CUSTOM;
  const sets: Record<string, unknown> = {
    package: last.package,
    // Zoneless local-wall stamp: a bare 'YYYY-MM-DD' parses as UTC midnight,
    // which reads as the prior evening on an Eastern browser.
    package_start_date: `${effectiveOf(last)}T00:00:00`,
  };
  if (isCustom) {
    for (const key of NUMBER_KEYS) {
      if (typeof last[key] === 'number') sets[key] = last[key];
    }
  }
  if (plan.schedule) sets.schedule = plan.schedule;
  if (plan.remaining.length > 0) sets.pending_changes = plan.remaining;
  if (isPrice(last.price_override)) sets.price_override = last.price_override;
  if (history.length > 0) sets.package_history = history;

  const removes: string[] = [...LEGACY_PENDING_FIELDS];
  if (plan.remaining.length === 0) removes.push('pending_changes');
  // Stale overrides must not leak into a later switch to CUSTOM.
  if (!isCustom) removes.push(...NUMBER_KEYS);
  if (!isPrice(last.price_override)) removes.push('price_override');
  removes.push('first_week_sessions');

  const promoted = { ...student, ...sets } as Student;
  for (const field of removes) {
    delete (promoted as unknown as Record<string, unknown>)[field];
  }
  return { promoted, sets, removes };
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
