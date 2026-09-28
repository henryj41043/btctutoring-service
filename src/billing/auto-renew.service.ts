import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StudentsService } from '../students/students.service';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { BillingService } from './billing.service';
import { PackagesService } from '../packages/packages.service';
import { StatementService } from './statement.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { Session, SessionType } from '../models/session.model';
import { buildStatement, keyOf } from './statement-engine';
import { easternSlotToUtc } from './eastern-time';
import { STUDENT_STATUS } from '../students/student-status';
import { applyPromotion } from '../students/pending-changes';
import {
  buildGroupRollSessions,
  buildTutoringSegmentSessions,
  PENDING_STATUS,
  scheduleSegmentsForMonth,
} from '../sessions/session-builder';

const ACTIVE_STUDENT = STUDENT_STATUS.ACTIVE_STUDENT;
const PENDING = PENDING_STATUS;

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
    private readonly packages: PackagesService,
    private readonly statements: StatementService,
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

    // Fetched BEFORE the lock: an empty (unseeded/broken) catalog must leave
    // the month lock unclaimed so a re-run after fixing the data still bills.
    const catalog = await this.packages.getCatalog();
    if (Object.keys(catalog).length === 0) {
      this.logger.error(
        'Auto-renew aborted: the package catalog is empty — seed the Packages table and re-run.',
      );
      return { sessionsCreated: 0, billingRecords: 0, skipped: true };
    }

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

    // The month that just ended is frozen FIRST, from the students as they
    // stand before any promotion below touches them. A failure is logged and
    // never blocks the new month (the freeze can be re-run by an admin).
    const closed = new Date(year, month - 1, 1);
    await this.statements
      .freezeMonth(
        this.monthKey(closed.getFullYear(), closed.getMonth()),
        now,
        { students, contacts, catalog },
      )
      .catch((err: Error) => {
        this.logger.error(`Freezing the closed month failed: ${err.message}`);
      });

    const monthStartDay = `${this.monthKey(year, month)}-01`;
    // A student whose last day of service fell before this month is done,
    // even if the daily job has not moved them out of Active yet (it runs
    // an hour after this one).
    const activeStudents = students.filter((s) => {
      if (s.status !== ACTIVE_STUDENT) return false;
      const end = keyOf(s.service_end_date);
      return !end || end >= monthStartDay;
    });
    const monthStart = new Date(year, month, 1);

    // Scheduled package changes: promote every due pending change BEFORE the
    // renewable filter and the billing loop, so both read the new package.
    // A past-dated effective (cron was down) promotes now too — its past
    // start date then flows through the normal renewable path.
    const monthStartKey = `${this.monthKey(year, month)}-01`;
    const promotedOnTime: Student[] = [];
    const promotedContactIds = new Set<string>();
    for (const student of activeStudents) {
      // Every due change (possibly several after a downed cron) is applied
      // in one write; the last due one wins.
      const result = applyPromotion(student, monthStartKey);
      if (!result) continue;
      try {
        // Snapshot: the persisted write must see the pending fields exactly
        // as loaded, independent of the in-memory mutation below.
        await this.students.promotePendingChanges(
          { ...student },
          monthStartKey,
        );
      } catch (err) {
        this.logger.error(
          `Pending-package promotion failed for ${student.id}`,
          err,
        );
        continue;
      }
      // Mirror the persisted promotion in-memory for the loops below (the
      // billing records read the new package, price and history).
      const onTime =
        `${result.promoted.package_start_date}`.slice(0, 10) === monthStartKey;
      for (const key of Object.keys(student)) {
        delete (student as unknown as Record<string, unknown>)[key];
      }
      Object.assign(student, result.promoted);
      promotedContactIds.add(student.contact_id);
      if (onTime) {
        promotedOnTime.push(student);
      }
    }

    // One fetch of the [month, month+2) window serves both the existence check
    // and the group-series roll. A student whose month already holds tutoring
    // sessions (pre-filled by the daily horizon job) is never regenerated.
    const windowSessions = await this.fetchWindow(year, month);
    const nextMonthIso = easternSlotToUtc(
      year,
      month + 1,
      1,
      '00:00',
    ).toISOString();
    const filledStudentIds = new Set(
      windowSessions
        .filter(
          (s) =>
            s.type === SessionType.TUTORING &&
            !!s.student_id &&
            s.start_datetime < nextMonthIso,
        )
        .map((s) => s.student_id),
    );

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
      if (filledStudentIds.has(student.id)) continue;
      const monthSessions = this.buildMonthSessions(
        student,
        contacts,
        year,
        month,
      );
      if (monthSessions.length > 0) {
        await this.sessions.createSessions(monthSessions);
        sessionsCreated += monthSessions.length;
      }
    }

    // Just-promoted on-time students: their start date EQUALS monthStart, so
    // the renewable '<' check excludes them — generate their first month on
    // the new schedule here (auto_renew still gates generation).
    for (const student of promotedOnTime) {
      if (!student.auto_renew || !student.schedule?.length) continue;
      if (filledStudentIds.has(student.id)) continue;
      const monthSessions = this.buildMonthSessions(
        student,
        contacts,
        year,
        month,
      );
      if (monthSessions.length > 0) {
        await this.sessions.createSessions(monthSessions);
        sessionsCreated += monthSessions.length;
      }
    }

    // BTC & Me: extend every still-running group series into this month.
    sessionsCreated += await this.rollGroupSeries(year, month, windowSessions);

    // Billing roll-forward: one record set per contact with a renewable
    // student, a BTC & Me enrollee (group-only families still owe the flat
    // fee), or a just-promoted package change (owed even with auto-renew off).
    const billableContactIds = new Set([
      ...renewable.map((s) => s.contact_id),
      ...activeStudents.filter((s) => s.btc_and_me).map((s) => s.contact_id),
      ...promotedContactIds,
    ]);
    let billingRecords = 0;
    for (const contactId of billableContactIds) {
      const contact = contacts.find((c) => c.id === contactId);
      if (!contact) continue;
      const contactStudents = activeStudents.filter(
        (s) => s.contact_id === contactId,
      );
      // The statement engine is the single source of the amounts (custom
      // prices, discounts, a prorated final month, the flat group fee).
      const statement = buildStatement(
        contact,
        contactStudents,
        [],
        year,
        month,
        catalog,
      );
      if (!statement || statement.total <= 0) continue;
      for (const due of statement.dues) {
        // A half with nothing due (a fee-only family's 15th, the blank side
        // of a prorated month) gets no record.
        if (due.derived <= 0) continue;
        billingRecords += await this.createRecord(
          contactId,
          due.period_start,
          statement.cycle,
          due.derived,
        );
      }
    }

    this.logger.log(
      `Auto-renew ${this.monthKey(year, month)}: ${sessionsCreated} session(s), ${billingRecords} billing record(s).`,
    );
    return { sessionsCreated, billingRecords, skipped: false };
  }

  /** The sessions of the Eastern-bounded [month, month+2) window. */
  private async fetchWindow(year: number, month: number): Promise<Session[]> {
    const windowStart = easternSlotToUtc(year, month, 1, '00:00');
    const windowEnd = easternSlotToUtc(year, month + 2, 1, '00:00');
    return (await this.sessions.getAllSessions({
      from: windowStart.toISOString(),
      to: windowEnd.toISOString(),
    })) as unknown as Session[];
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
  private async rollGroupSeries(
    year: number,
    month: number,
    all: Session[],
  ): Promise<number> {
    const nextMonthStart = easternSlotToUtc(year, month + 1, 1, '00:00');
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
      const nextSessions = buildGroupRollSessions(latest, year, month + 1);
      if (nextSessions.length > 0) {
        await this.sessions.createSessions(nextSessions);
        created += nextSessions.length;
      }
    }
    return created;
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
    contacts: Contact[],
    year: number,
    month: number,
  ): Session[] {
    const seriesIdByTutor = new Map<string, string>();
    const sessions: Session[] = [];
    for (const segment of scheduleSegmentsForMonth(student, year, month)) {
      const built = buildTutoringSegmentSessions(segment, {
        student,
        tutorNameById: (id) => contacts.find((c) => c.id === id)?.first_name,
        year,
        month,
        seriesIdByTutor,
      });
      for (const s of built) {
        if (s.series_id) seriesIdByTutor.set(s.tutor_id, s.series_id);
      }
      sessions.push(...built);
    }
    return sessions;
  }

  private monthKey(year: number, month: number): string {
    return `${year}-${(month + 1).toString().padStart(2, '0')}`;
  }
}
