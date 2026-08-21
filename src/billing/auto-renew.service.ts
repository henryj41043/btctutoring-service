import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { StudentsService } from '../students/students.service';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { BillingService } from './billing.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { Session, SessionType } from '../models/session.model';
import { resolvePackageDef, round2 } from './package-config';
import { semiMonthlySplit } from './proration';
import {
  studentMonthlyCharge,
  siblingDiscountedTotal,
  groupSessionFee,
} from './billing-amount';
import { easternSlotToUtc, utcToEasternWall } from './eastern-time';
import { STUDENT_STATUS } from '../students/student-status';

const ACTIVE_STUDENT = STUDENT_STATUS.ACTIVE_STUDENT;
const PENDING = 'Pending';
/** BTC & Me sessions are always exactly 45 minutes (client policy). */
const GROUP_SESSION_MINUTES = 45;
/** JS Date.getDay() (0=Sunday) → the stored weekday string. */
const WEEKDAY_BY_JS_DAY = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/**
 * Monthly auto-renew: when a new month starts, each active student with
 * `auto_renew` and a saved `schedule` gets that month's tutoring sessions
 * generated, and their contact gets that month's billing record(s) created.
 *
 * A conditional-write lock makes the whole run idempotent so it executes once
 * even across multiple ECS tasks (or restarts) in the same month.
 */
@Injectable()
export class AutoRenewService {
  private readonly logger = new Logger(AutoRenewService.name);

  constructor(
    private readonly students: StudentsService,
    private readonly sessions: SessionsService,
    private readonly contacts: ContactsService,
    private readonly billing: BillingService,
  ) {}

  // 06:00 (container time, UTC on Fargate) on the 1st of every month.
  @Cron('0 6 1 * *')
  async handleMonthlyRenewal(): Promise<void> {
    await this.runAutoRenew(new Date());
  }

  /**
   * Rolls schedules + billing into the month containing `now`. Exposed (not just
   * the @Cron handler) so it can be unit-tested with a fixed clock.
   */
  async runAutoRenew(now: Date): Promise<{
    sessionsCreated: number;
    billingRecords: number;
    skipped: boolean;
  }> {
    const year = now.getFullYear();
    const month = now.getMonth();
    const lockId = `lock#auto-renew#${this.monthKey(year, month)}`;

    const acquired = await this.billing.acquireLock(lockId);
    if (!acquired) {
      this.logger.log(
        `Auto-renew for ${this.monthKey(year, month)} already done; skipping.`,
      );
      return { sessionsCreated: 0, billingRecords: 0, skipped: true };
    }

    const [studentsRes, contactsRes] = await Promise.all([
      this.students.getStudents(),
      this.contacts.getContacts(),
    ]);
    const students = studentsRes as unknown as Student[];
    const contacts = contactsRes as unknown as Contact[];

    const activeStudents = students.filter((s) => s.status === ACTIVE_STUDENT);
    const monthStart = new Date(year, month, 1);

    // Session roll-forward: auto-renew students whose package started in a prior
    // month (the start month's sessions were created when the schedule was set).
    const renewable = activeStudents.filter(
      (s) =>
        s.auto_renew &&
        s.schedule &&
        s.schedule.length > 0 &&
        s.package_start_date &&
        new Date(s.package_start_date) < monthStart,
    );

    let sessionsCreated = 0;
    for (const student of renewable) {
      const tutor = contacts.find((c) => c.id === student.assigned_tutor_id);
      const monthSessions = this.buildMonthSessions(
        student,
        tutor,
        year,
        month,
      );
      if (monthSessions.length > 0) {
        await this.sessions.createSessions(monthSessions);
        sessionsCreated += monthSessions.length;
      }
    }

    // BTC & Me: extend every still-running group series into this month.
    sessionsCreated += await this.rollGroupSeries(year, month);

    // Billing roll-forward: one record set per contact with a renewable student
    // or a BTC & Me enrollee (group-only families still owe the flat fee).
    const billableContactIds = new Set([
      ...renewable.map((s) => s.contact_id),
      ...activeStudents.filter((s) => s.btc_and_me).map((s) => s.contact_id),
    ]);
    let billingRecords = 0;
    for (const contactId of billableContactIds) {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) continue;
      const contactStudents = activeStudents.filter(
        (s) => s.contact_id === contactId,
      );
      const preDiscount = round2(
        contactStudents.reduce(
          (sum, s) => sum + studentMonthlyCharge(s, year, month),
          0,
        ),
      );
      const enrolledCount = contactStudents.filter((s) =>
        this.isEnrolled(s),
      ).length;
      const total = siblingDiscountedTotal(
        preDiscount,
        contact.sibling_discount,
        enrolledCount,
      );
      // The flat group fee is never sibling-discounted and never prorated —
      // added after the discount, in full (client policy).
      const groupFee = groupSessionFee(contactStudents);
      if (total + groupFee <= 0) continue;

      if (this.isSemiMonthly(contact.billing_cycle)) {
        // Only the package total splits across the halves; the flat fee lands
        // on the 1st (always > 0 here, since total + fee > 0 and any positive
        // total puts its larger half first). A fee-only family gets just the
        // day-1 record.
        const [first, second] = semiMonthlySplit(total);
        billingRecords += await this.createRecord(
          contactId,
          this.periodKey(year, month, 1),
          'semi_monthly',
          round2(first + groupFee),
        );
        if (second > 0) {
          billingRecords += await this.createRecord(
            contactId,
            this.periodKey(year, month, 15),
            'semi_monthly',
            second,
          );
        }
      } else {
        billingRecords += await this.createRecord(
          contactId,
          this.periodKey(year, month, 1),
          'monthly',
          round2(total + groupFee),
        );
      }
    }

    this.logger.log(
      `Auto-renew ${this.monthKey(year, month)}: ${sessionsCreated} session(s), ${billingRecords} billing record(s).`,
    );
    return { sessionsCreated, billingRecords, skipped: false };
  }

  /**
   * Rolls every still-running "BTC & Me" group series one month forward:
   * a series with at least one PENDING session in the new current month gets
   * next month's weekly occurrences generated, copying tutor/roster/time from
   * its latest occurrence (so mid-month "this and future" edits carry over).
   * Cancelling a group ("delete this and future") leaves no pending sessions,
   * so the series simply never rolls again. Returns the number of sessions
   * created.
   */
  private async rollGroupSeries(year: number, month: number): Promise<number> {
    // Eastern month boundaries; sessions store UTC ISO strings.
    const windowStart = easternSlotToUtc(year, month, 1, '00:00');
    const nextMonthStart = easternSlotToUtc(year, month + 1, 1, '00:00');
    const windowEnd = easternSlotToUtc(year, month + 2, 1, '00:00');
    const all = (await this.sessions.getAllSessions({
      from: windowStart.toISOString(),
      to: windowEnd.toISOString(),
    })) as unknown as Session[];

    const groupSessions = all.filter(
      (s) => s.type === SessionType.GROUP && s.series_id && s.start_datetime,
    );
    const nextIso = nextMonthStart.toISOString();
    // Belt-and-braces idempotency on top of the month lock: a series that
    // already has next-month sessions is never extended twice.
    const alreadyRolled = new Set(
      groupSessions
        .filter((s) => s.start_datetime >= nextIso)
        .map((s) => s.series_id),
    );
    const bySeries = new Map<string, Session[]>();
    for (const session of groupSessions) {
      if (session.start_datetime >= nextIso) continue;
      const list = bySeries.get(session.series_id!) ?? [];
      list.push(session);
      bySeries.set(session.series_id!, list);
    }

    let created = 0;
    for (const [seriesId, sessions] of bySeries) {
      if (alreadyRolled.has(seriesId)) continue;
      if (!sessions.some((s) => s.status === PENDING)) continue;
      const latest = sessions.reduce((a, b) =>
        a.start_datetime > b.start_datetime ? a : b,
      );
      // Carry the Eastern wall time, not the UTC offset — a series created in
      // EDT must stay at (e.g.) 5pm Eastern after the November transition.
      const wall = utcToEasternWall(new Date(latest.start_datetime));
      const nextSessions: Session[] = [];
      // month + 1 may overflow into January — Date/Date.UTC normalize it.
      const daysInNextMonth = new Date(year, month + 2, 0).getDate();
      for (let day = 1; day <= daysInNextMonth; day++) {
        const date = new Date(year, month + 1, day);
        if (WEEKDAY_BY_JS_DAY[date.getDay()] !== wall.weekday) continue;
        const start = easternSlotToUtc(year, month + 1, day, wall.time);
        nextSessions.push({
          type: SessionType.GROUP,
          start_datetime: start.toISOString(),
          end_datetime: new Date(
            start.getTime() + GROUP_SESSION_MINUTES * 60000,
          ).toISOString(),
          status: PENDING,
          notes: '',
          student_name: latest.student_name,
          tutor_id: latest.tutor_id,
          tutor_name: latest.tutor_name,
          series_id: seriesId,
          participants: latest.participants,
        } as Session);
      }
      if (nextSessions.length > 0) {
        await this.sessions.createSessions(nextSessions);
        created += nextSessions.length;
      }
    }
    return created;
  }

  /** True when a student has a resolvable package — i.e. is enrolled and billable. */
  private isEnrolled(student: Student): boolean {
    return (
      resolvePackageDef(student.package, {
        monthlyCost: student.custom_monthly_cost,
        sessionsPerWeek: student.custom_sessions_per_week,
        sessionLengthMin: student.custom_session_length_min,
      }) !== null
    );
  }

  private async createRecord(
    contactId: string,
    period: string,
    cycle: string,
    amount: number,
  ): Promise<number> {
    const res = await this.billing.createBillingRecordIfAbsent({
      contact_id: contactId,
      period_start: period,
      cycle,
      amount,
      paid: false,
    });
    return res.created ? 1 : 0;
  }

  private buildMonthSessions(
    student: Student,
    tutor: Contact | undefined,
    year: number,
    month: number,
  ): Session[] {
    const sessions: Session[] = [];
    const seriesId = randomUUID();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (const slot of student.schedule ?? []) {
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        if (WEEKDAY_BY_JS_DAY[date.getDay()] !== slot.weekday) continue;
        sessions.push({
          type: SessionType.TUTORING,
          // Slot times are Eastern wall times; the container clock is UTC, so
          // the conversion must be explicit (ambient setHours generated the
          // 4-5h-early sessions this replaces).
          start_datetime: easternSlotToUtc(
            year,
            month,
            day,
            slot.start_time,
          ).toISOString(),
          end_datetime: easternSlotToUtc(
            year,
            month,
            day,
            slot.end_time,
          ).toISOString(),
          status: PENDING,
          notes: '',
          student_id: student.id,
          student_name: student.name,
          tutor_id: student.assigned_tutor_id,
          tutor_name: tutor?.first_name ?? '',
          series_id: seriesId,
        } as Session);
      }
    }
    return sessions;
  }

  private periodKey(year: number, month: number, day: number): string {
    return `${this.monthKey(year, month)}-${day.toString().padStart(2, '0')}`;
  }

  private monthKey(year: number, month: number): string {
    return `${year}-${(month + 1).toString().padStart(2, '0')}`;
  }

  private isSemiMonthly(cycle: string | undefined): boolean {
    return cycle === 'semi_monthly' || cycle === 'biweekly';
  }
}
