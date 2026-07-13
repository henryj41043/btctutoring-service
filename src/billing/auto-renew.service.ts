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
import { studentMonthlyCharge, siblingDiscountedTotal } from './billing-amount';
import { STUDENT_STATUS } from '../students/student-status';

const ACTIVE_STUDENT = STUDENT_STATUS.ACTIVE_STUDENT;
const PENDING = 'Pending';
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

    // Billing roll-forward: one record set per contact with a renewable student.
    const renewContactIds = new Set(renewable.map((s) => s.contact_id));
    let billingRecords = 0;
    for (const contactId of renewContactIds) {
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
      if (total <= 0) continue;

      if (this.isSemiMonthly(contact.billing_cycle)) {
        const [first, second] = semiMonthlySplit(total);
        billingRecords += await this.createRecord(
          contactId,
          this.periodKey(year, month, 1),
          'semi_monthly',
          first,
        );
        billingRecords += await this.createRecord(
          contactId,
          this.periodKey(year, month, 15),
          'semi_monthly',
          second,
        );
      } else {
        billingRecords += await this.createRecord(
          contactId,
          this.periodKey(year, month, 1),
          'monthly',
          total,
        );
      }
    }

    this.logger.log(
      `Auto-renew ${this.monthKey(year, month)}: ${sessionsCreated} session(s), ${billingRecords} billing record(s).`,
    );
    return { sessionsCreated, billingRecords, skipped: false };
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
          start_datetime: this.atTime(date, slot.start_time).toISOString(),
          end_datetime: this.atTime(date, slot.end_time).toISOString(),
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

  private atTime(date: Date, time: string): Date {
    const [h, m] = (time ?? '').split(':').map(Number);
    const d = new Date(date);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
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
