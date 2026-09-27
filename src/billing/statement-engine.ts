import {
  FirstWeekSession,
  ScheduleSlot,
  Student,
} from '../models/student.model';
import { Contact } from '../models/contact.model';
import { BillingRecord } from '../models/billing-record.model';
import { pendingChangesOf } from '../students/pending-changes';
import { STUDENT_STATUS } from '../students/student-status';
import { WEEKDAY_BY_JS_DAY } from '../sessions/session-builder';
import {
  PackageCatalog,
  perSessionCost,
  resolvePackageDef,
  round2,
} from './package-config';
import { GROUP_MONTHLY_FEE, siblingDiscountedTotal } from './billing-amount';

/**
 * Billing v2 statement engine (pure — no Nest deps). The single source of
 * truth for what a family owes in a month: the app displays what this
 * returns. A student's month is made of SERVICE SEGMENTS (a package, price
 * and weekly schedule between two dates) and every partial month — a start,
 * an ending or a package change — is priced by one rule:
 *
 *   a segment that covers every scheduled session of the month bills the
 *   full monthly price; any other segment bills per scheduled session,
 *   capped at the monthly price.
 *
 * Sessions are counted from the SCHEDULE, never from attendance.
 */

export type LineFlag =
  | 'prorated_start'
  | 'prorated_end'
  | 'package_change'
  | 'price_override'
  | 'discount'
  | 'unpriced';

/** How a student's charge lands on a semi-monthly family's two due dates. */
export type SplitKind = 'split' | 'first' | 'fifteenth';

/** A package, price and schedule between two dates (both inclusive). */
export interface ServiceSegment {
  package: string;
  /** 'YYYY-MM-DD'; absent = open-ended (a legacy student with no start date). */
  start?: string;
  /** 'YYYY-MM-DD'; absent = still running. */
  end?: string;
  custom_monthly_cost?: number;
  custom_sessions_per_week?: number;
  custom_session_length_min?: number;
  price_override?: number;
  discount_percent?: number;
  schedule?: ScheduleSlot[];
  first_week_sessions?: FirstWeekSession[];
}

export interface StatementLine {
  student_id?: string;
  student_name: string;
  /** 'package' = a service segment; 'prior_package' = a legacy mid-month change portion. */
  kind: 'package' | 'prior_package';
  package: string;
  /** First and last billed day of the segment inside the month. */
  from: string;
  to: string;
  sessions_billed: number;
  sessions_in_month: number;
  /** Per-session rate of the effective monthly price. */
  rate: number;
  monthly_price: number;
  /** The charge before the student discount. */
  amount: number;
  discount_percent: number;
  discount_amount: number;
  /** The charge after the student discount. */
  net: number;
  flags: LineFlag[];
}

export interface StatementDue {
  day: number;
  /** 'YYYY-MM-DD' — the per-date billing record key. */
  period_start: string;
  /** What the engine calculated for this date. */
  derived: number;
  /** The admin's per-date override (0 = no charge); null when none. */
  override: number | null;
  /** The amount actually due: the override when set, else derived. */
  amount: number;
  paid: boolean;
  paid_date?: string;
  invoice_number?: string;
}

export interface Statement {
  contact_id: string;
  contact_name: string;
  /** 'YYYY-MM' */
  month: string;
  cycle: 'monthly' | 'semi_monthly';
  lines: StatementLine[];
  /** Package charges before any discount. */
  package_gross: number;
  /** Package charges after the student discounts. */
  package_subtotal: number;
  sibling_discount_percent: number;
  sibling_discount_amount: number;
  /** Flat BTC & Me fee — never discounted, never prorated. */
  group_fee: number;
  /** Names of the students the group fee covers. */
  group_students: string[];
  /** The calculated month total (before per-date overrides). */
  total: number;
  dues: StatementDue[];
  /** Sum of the amounts actually due (after per-date overrides). */
  total_due: number;
  /** Every flag present on the statement's lines. */
  flags: LineFlag[];
  needs_attention: boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a 0-indexed month. */
export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** The date part of a stored date or datetime string. */
export function keyOf(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string' || value.length < 10) return undefined;
  return value.slice(0, 10);
}

/** The calendar day before a 'YYYY-MM-DD' key. */
export function dayBefore(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d - 1);
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Parses 'YYYY-MM' into a year and 0-indexed month; null when malformed. */
export function parseMonth(
  month: string,
): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!match) return null;
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  return { year: Number(match[1]), month: m - 1 };
}

/** Scheduled slots falling on the days of [from, to] within one month. */
export function countSlotsBetween(
  schedule: ScheduleSlot[],
  year: number,
  month: number,
  from: string,
  to: string,
): number {
  if (schedule.length === 0) return 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    if (key < from || key > to) continue;
    const weekday = WEEKDAY_BY_JS_DAY[new Date(year, month, day).getDay()];
    count += schedule.filter((s) => s.weekday === weekday).length;
  }
  return count;
}

const clampPercent = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(100, value);
};

const validPrice = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The student's service segments, oldest first: closed history, the current
 * package, then each scheduled change. A scheduled change without its own
 * schedule inherits the one in force before it. Everything is cut off at the
 * service end date.
 */
export function segmentsOf(student: Student): ServiceSegment[] {
  const segments: ServiceSegment[] = (student.package_history ?? [])
    .filter((h) => !!h && !!h.package && !!h.start && !!h.end)
    .map((h) => ({ ...h }));

  const changes = pendingChangesOf(student);
  let schedule = student.schedule;
  if (student.package) {
    const current: ServiceSegment = {
      package: student.package,
      start: keyOf(student.package_start_date),
      custom_monthly_cost: student.custom_monthly_cost,
      custom_sessions_per_week: student.custom_sessions_per_week,
      custom_session_length_min: student.custom_session_length_min,
      price_override: student.price_override,
      discount_percent: student.discount_percent,
      schedule,
      first_week_sessions: student.first_week_sessions,
    };
    if (changes.length > 0) {
      current.end = dayBefore(changes[0].effective.slice(0, 10));
    }
    segments.push(current);
  }
  changes.forEach((change, i) => {
    if (change.schedule && change.schedule.length > 0) {
      schedule = change.schedule;
    }
    const next = changes[i + 1];
    const segment: ServiceSegment = {
      package: change.package,
      start: change.effective.slice(0, 10),
      custom_monthly_cost: change.custom_monthly_cost,
      custom_sessions_per_week: change.custom_sessions_per_week,
      custom_session_length_min: change.custom_session_length_min,
      price_override: change.price_override,
      discount_percent: student.discount_percent,
      schedule,
    };
    if (next) segment.end = dayBefore(next.effective.slice(0, 10));
    segments.push(segment);
  });

  const serviceEnd = keyOf(student.service_end_date);
  if (!serviceEnd) return segments;
  return segments
    .filter((s) => !s.start || s.start <= serviceEnd)
    .map((s) => ({
      ...s,
      end: s.end && s.end < serviceEnd ? s.end : serviceEnd,
    }));
}

/** One segment's line for a month; null when the segment misses the month. */
export function segmentLine(
  segment: ServiceSegment,
  student: Pick<Student, 'id' | 'name'>,
  year: number,
  month: number,
  catalog: PackageCatalog,
): StatementLine | null {
  const monthStart = dateKey(year, month, 1);
  const monthEnd = dateKey(year, month, new Date(year, month + 1, 0).getDate());
  const from =
    segment.start && segment.start > monthStart ? segment.start : monthStart;
  const to = segment.end && segment.end < monthEnd ? segment.end : monthEnd;
  if (from > to) return null;

  const base: StatementLine = {
    student_id: student.id,
    student_name: student.name ?? '',
    kind: 'package',
    package: segment.package,
    from,
    to,
    sessions_billed: 0,
    sessions_in_month: 0,
    rate: 0,
    monthly_price: 0,
    amount: 0,
    discount_percent: 0,
    discount_amount: 0,
    net: 0,
    flags: [],
  };

  const def = resolvePackageDef(segment.package, catalog, {
    monthlyCost: segment.custom_monthly_cost,
    sessionsPerWeek: segment.custom_sessions_per_week,
    sessionLengthMin: segment.custom_session_length_min,
  });
  if (!def) {
    // An unconfigured Custom package (or one missing from the catalog) can't
    // be priced: shown at $0 and flagged rather than silently dropped.
    return { ...base, flags: ['unpriced'] };
  }

  const overridden = validPrice(segment.price_override);
  const monthly = overridden ? segment.price_override! : def.monthlyCost;
  const rate = perSessionCost({ ...def, monthlyCost: monthly });
  const schedule = segment.schedule ?? [];
  const inMonth = countSlotsBetween(
    schedule,
    year,
    month,
    monthStart,
    monthEnd,
  );
  const regular = countSlotsBetween(schedule, year, month, from, to);
  const oneOff = (segment.first_week_sessions ?? []).filter(
    (s) => !!s && typeof s.date === 'string' && s.date >= from && s.date <= to,
  ).length;
  const billed = regular + oneOff;

  // Without a schedule the sessions can't be counted: bill the full month
  // rather than $0 (the statement is flagged for attention).
  const full = schedule.length === 0 || billed >= inMonth;
  const amount = full ? monthly : Math.min(monthly, round2(rate * billed));

  const flags: LineFlag[] = [];
  if (!full && from > monthStart) flags.push('prorated_start');
  if (!full && to < monthEnd) flags.push('prorated_end');
  if (overridden) flags.push('price_override');

  return withDiscount(
    {
      ...base,
      sessions_billed: schedule.length === 0 ? 0 : billed,
      sessions_in_month: inMonth,
      rate,
      monthly_price: monthly,
      amount,
      flags,
    },
    segment.discount_percent,
  );
}

/** Applies a student discount percent to a line. */
function withDiscount(
  line: StatementLine,
  percent: number | undefined,
): StatementLine {
  const pct = clampPercent(percent);
  const discount = round2((line.amount * pct) / 100);
  const flags = [...line.flags];
  if (discount > 0) flags.push('discount');
  return {
    ...line,
    discount_percent: discount > 0 ? pct : 0,
    discount_amount: discount,
    net: round2(line.amount - discount),
    flags,
  };
}

/**
 * Every line a student contributes to a month, oldest first. A month with
 * more than one line is a package-change month: only the outer boundaries
 * keep their prorated start / end flags.
 */
export function studentLines(
  student: Student,
  year: number,
  month: number,
  catalog: PackageCatalog,
): StatementLine[] {
  const lines: StatementLine[] = [];
  const monthKey = `${year}-${pad(month + 1)}`;

  // Legacy mid-month change (pre-v2 "change today"): the old package's
  // portion was stored as a flat amount for that month only.
  if (
    student.mid_month_change_period === monthKey &&
    student.mid_month_prior_charge
  ) {
    const monthStart = dateKey(year, month, 1);
    const start = keyOf(student.package_start_date);
    lines.push(
      withDiscount(
        {
          student_id: student.id,
          student_name: student.name ?? '',
          kind: 'prior_package',
          package: 'Previous package',
          from: monthStart,
          to: start && start > monthStart ? dayBefore(start) : monthStart,
          sessions_billed: 0,
          sessions_in_month: 0,
          rate: 0,
          monthly_price: 0,
          amount: round2(student.mid_month_prior_charge),
          discount_percent: 0,
          discount_amount: 0,
          net: 0,
          flags: [],
        },
        student.discount_percent,
      ),
    );
  }

  for (const segment of segmentsOf(student)) {
    const line = segmentLine(segment, student, year, month, catalog);
    if (line) lines.push(line);
  }

  if (lines.length < 2) return lines;
  const last = lines.length - 1;
  return lines.map((line, i) => ({
    ...line,
    flags: [
      ...line.flags.filter(
        (f) =>
          !(f === 'prorated_start' && i !== 0) &&
          !(f === 'prorated_end' && i !== last),
      ),
      'package_change' as LineFlag,
    ],
  }));
}

/**
 * Where a semi-monthly family pays a student's month: a prorated start on
 * or after the 15th lands entirely on the 15th, a prorated ending before
 * the 15th entirely on the 1st, everything else splits evenly.
 */
export function splitKindOf(lines: StatementLine[]): SplitKind {
  if (lines.length === 0) return 'split';
  const first = lines[0];
  const last = lines[lines.length - 1];
  const dayOf = (key: string): number => Number(key.slice(8, 10));
  if (first.flags.includes('prorated_start') && dayOf(first.from) >= 15) {
    return 'fifteenth';
  }
  if (last.flags.includes('prorated_end') && dayOf(last.to) < 15) {
    return 'first';
  }
  return 'split';
}

/**
 * True when the student belongs on a month's statement: enrolled (a package
 * or BTC & Me) and either Active or carrying a service end date that reaches
 * the month — so a student who has left stays on the months they were served.
 */
export function isBillableInMonth(
  student: Student,
  year: number,
  month: number,
): boolean {
  if (!student.contact_id) return false;
  if (!student.package && !student.btc_and_me) return false;
  const serviceEnd = keyOf(student.service_end_date);
  if (serviceEnd) return serviceEnd >= dateKey(year, month, 1);
  return student.status === STUDENT_STATUS.ACTIVE_STUDENT;
}

/** True when a packaged student can't be priced or prorated confidently. */
export function studentNeedsAttention(
  student: Student,
  catalog: PackageCatalog,
): boolean {
  const def = resolvePackageDef(student.package, catalog, {
    monthlyCost: student.custom_monthly_cost,
    sessionsPerWeek: student.custom_sessions_per_week,
    sessionLengthMin: student.custom_session_length_min,
  });
  if (!def) return true;
  return (
    !student.package_start_date ||
    !student.schedule ||
    student.schedule.length === 0
  );
}

const isSemiMonthly = (cycle: string | undefined): boolean =>
  cycle === 'semi_monthly' || cycle === 'biweekly';

/**
 * One family's statement for a month; null when nothing is billable.
 * Order of operations: price → proration → student discount → sibling
 * discount (3+ packaged students) → flat group fee → semi-monthly split →
 * per-date override.
 */
export function buildStatement(
  contact: Contact,
  students: Student[],
  records: BillingRecord[],
  year: number,
  month: number,
  catalog: PackageCatalog,
): Statement | null {
  const billable = students.filter(
    (s) => s.contact_id === contact.id && isBillableInMonth(s, year, month),
  );
  if (billable.length === 0) return null;

  const packaged = billable.filter((s) => !!s.package);
  const lines: StatementLine[] = [];
  let rawFirst = 0;
  for (const student of packaged) {
    const own = studentLines(student, year, month, catalog);
    lines.push(...own);
    const net = own.reduce((sum, l) => sum + l.net, 0);
    const kind = splitKindOf(own);
    if (kind === 'first') rawFirst += net;
    else if (kind === 'split') rawFirst += net / 2;
  }

  const gross = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const subtotal = round2(lines.reduce((sum, l) => sum + l.net, 0));
  const groupStudents = billable.filter((s) => s.btc_and_me);
  const groupFee = GROUP_MONTHLY_FEE * groupStudents.length;
  if (gross <= 0 && groupFee <= 0) return null;

  const discounted = siblingDiscountedTotal(
    subtotal,
    contact.sibling_discount,
    packaged.length,
  );
  const siblingAmount = round2(subtotal - discounted);
  const total = round2(discounted + groupFee);

  const semi = isSemiMonthly(contact.billing_cycle);
  const derived: { day: number; amount: number }[] = [];
  if (semi) {
    const first = subtotal > 0 ? round2((discounted * rawFirst) / subtotal) : 0;
    // The flat group fee lands on the 1st for semi-monthly families.
    derived.push({ day: 1, amount: round2(first + groupFee) });
    derived.push({ day: 15, amount: round2(discounted - first) });
  } else {
    derived.push({ day: 1, amount: total });
  }

  const dues: StatementDue[] = derived.map(({ day, amount }) => {
    const period = dateKey(year, month, day);
    const record = records.find(
      (r) => r.contact_id === contact.id && r.period_start === period,
    );
    const override =
      typeof record?.amount_override === 'number'
        ? record.amount_override
        : null;
    const due: StatementDue = {
      day,
      period_start: period,
      derived: amount,
      override,
      amount: override ?? amount,
      paid: record?.paid ?? false,
    };
    if (record?.paid_date) due.paid_date = record.paid_date;
    if (record?.invoice_number) due.invoice_number = record.invoice_number;
    return due;
  });

  const flags: LineFlag[] = [];
  for (const line of lines) {
    for (const flag of line.flags) {
      if (!flags.includes(flag)) flags.push(flag);
    }
  }

  return {
    contact_id: contact.id!,
    contact_name:
      `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
    month: `${year}-${pad(month + 1)}`,
    cycle: semi ? 'semi_monthly' : 'monthly',
    lines,
    package_gross: gross,
    package_subtotal: subtotal,
    sibling_discount_percent: siblingAmount > 0 ? contact.sibling_discount! : 0,
    sibling_discount_amount: siblingAmount,
    group_fee: groupFee,
    group_students: groupStudents.map((s) => s.name ?? ''),
    total,
    dues,
    total_due: round2(dues.reduce((sum, d) => sum + d.amount, 0)),
    flags,
    needs_attention: packaged.some((s) => studentNeedsAttention(s, catalog)),
  };
}

/** Every family's statement for a month, sorted by contact name. */
export function buildStatements(
  contacts: Contact[],
  students: Student[],
  records: BillingRecord[],
  year: number,
  month: number,
  catalog: PackageCatalog,
): Statement[] {
  const contactIds = new Set(
    students.filter((s) => !!s.contact_id).map((s) => s.contact_id),
  );
  const statements: Statement[] = [];
  for (const contact of contacts) {
    if (!contact.id || !contactIds.has(contact.id)) continue;
    const statement = buildStatement(
      contact,
      students,
      records,
      year,
      month,
      catalog,
    );
    if (statement) statements.push(statement);
  }
  return statements.sort((a, b) =>
    a.contact_name.localeCompare(b.contact_name),
  );
}
