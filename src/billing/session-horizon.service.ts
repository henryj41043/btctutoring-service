import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StudentsService } from '../students/students.service';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { BillingService } from './billing.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { Session, SessionType } from '../models/session.model';
import { easternSlotToUtc } from './eastern-time';
import { monthKey } from './billing-amount';
import { STUDENT_STATUS } from '../students/student-status';
import {
  buildGroupRollSessions,
  buildTutoringMonthSessions,
  governingSlotsForMonth,
  HORIZON_MONTHS_AHEAD,
  normalizeMonth,
  PENDING_STATUS,
} from '../sessions/session-builder';

export interface HorizonFillOptions {
  /** Take the per-day lock (the cron); manual/app-triggered fills run without. */
  lock?: boolean;
  /** Fill one student only (after a schedule save); skips the group roll. */
  studentId?: string;
}

export interface HorizonFillResult {
  studentsFilled: number;
  sessionsCreated: number;
  groupSessionsCreated: number;
  /** Student-months left empty because a scheduled change has no schedule yet. */
  monthsSkippedNoSchedule: number;
  lockedOut: boolean;
}

interface SeriesRef {
  seriesId: string;
  start: string;
}

/**
 * Daily self-healing fill: every active auto-renew student with a schedule
 * has tutoring sessions through the current month + HORIZON_MONTHS_AHEAD, and
 * every still-running "BTC & Me" series is rolled the same distance. The
 * CURRENT month is never touched here — it belongs to the app's rest-of-month
 * generation and the 1st-of-month auto-renew run — so this job never creates
 * past-dated sessions. Idempotent per student-month: a month with ANY
 * tutoring session (even all cancelled) is left alone.
 */
@Injectable()
export class SessionHorizonService {
  private readonly logger = new Logger(SessionHorizonService.name);

  constructor(
    private readonly students: StudentsService,
    private readonly sessions: SessionsService,
    private readonly contacts: ContactsService,
    private readonly billing: BillingService,
  ) {}

  // 07:00 UTC daily — an hour after the 1st-of-month promotion run.
  @Cron('0 7 * * *')
  async handleDaily(): Promise<void> {
    await this.fillHorizon(new Date(), { lock: true });
  }

  async fillHorizon(
    now: Date,
    opts: HorizonFillOptions = {},
  ): Promise<HorizonFillResult> {
    const result: HorizonFillResult = {
      studentsFilled: 0,
      sessionsCreated: 0,
      groupSessionsCreated: 0,
      monthsSkippedNoSchedule: 0,
      lockedOut: false,
    };
    const dayKey = now.toISOString().slice(0, 10);
    if (opts.lock) {
      const acquired = await this.billing.acquireLock(`lock#horizon#${dayKey}`);
      if (!acquired) {
        this.logger.log(`Horizon fill for ${dayKey} already done; skipping.`);
        return { ...result, lockedOut: true };
      }
    }

    const year = now.getFullYear();
    const month = now.getMonth();
    // Eastern month-start boundaries for [current .. current+HORIZON+1);
    // sessions store UTC ISO strings, which sort lexically.
    const boundaries = Array.from(
      { length: HORIZON_MONTHS_AHEAD + 2 },
      (_, i) => easternSlotToUtc(year, month + i, 1, '00:00').toISOString(),
    );
    const range = {
      from: boundaries[0],
      to: boundaries[HORIZON_MONTHS_AHEAD + 1],
    };
    const [studentsRes, contactsRes, sessionsRes] = await Promise.all([
      opts.studentId
        ? this.students.getStudent(opts.studentId)
        : this.students.getStudents(),
      this.contacts.getContacts(),
      opts.studentId
        ? this.sessions.getSessionsByStudent(opts.studentId, range)
        : this.sessions.getAllSessions(range),
    ]);
    const students = studentsRes as unknown as Student[];
    const contacts = contactsRes as unknown as Contact[];
    const windowSessions = sessionsRes as unknown as Session[];
    const tutorNameById = (id: string): string | undefined =>
      contacts.find((c) => c.id === id)?.first_name;
    // Month index (0 = current) of an instant, or -1 outside the window.
    const monthIndexOf = (iso: string): number => {
      let idx = -1;
      for (let i = 0; i <= HORIZON_MONTHS_AHEAD; i++) {
        if (iso >= boundaries[i] && iso < boundaries[i + 1]) idx = i;
      }
      return idx;
    };

    // Buckets: tutoring months per student, latest series per (student, tutor),
    // and group sessions per series.
    const tutoringMonths = new Map<string, Set<number>>();
    const seriesByStudent = new Map<string, Map<string, SeriesRef>>();
    const groupBySeries = new Map<string, Session[]>();
    for (const s of windowSessions) {
      const idx = monthIndexOf(s.start_datetime ?? '');
      if (idx < 0) continue;
      if (s.type === SessionType.TUTORING && s.student_id) {
        let months = tutoringMonths.get(s.student_id);
        if (!months) tutoringMonths.set(s.student_id, (months = new Set()));
        months.add(idx);
        if (s.series_id && s.tutor_id) {
          let byTutor = seriesByStudent.get(s.student_id);
          if (!byTutor)
            seriesByStudent.set(
              s.student_id,
              (byTutor = new Map<string, SeriesRef>()),
            );
          const prev = byTutor.get(s.tutor_id);
          if (!prev || s.start_datetime > prev.start) {
            byTutor.set(s.tutor_id, {
              seriesId: s.series_id,
              start: s.start_datetime,
            });
          }
        }
      } else if (s.type === SessionType.GROUP && s.series_id) {
        const list = groupBySeries.get(s.series_id) ?? [];
        list.push(s);
        groupBySeries.set(s.series_id, list);
      }
    }

    for (const student of students) {
      if (!this.isEligible(student)) continue;
      const start = new Date(student.package_start_date!);
      const startKey = monthKey(start.getFullYear(), start.getMonth());
      const months = tutoringMonths.get(student.id!) ?? new Set<number>();
      const seriesIdByTutor = new Map<string, string>(
        [
          ...(seriesByStudent.get(student.id!) ?? new Map<string, SeriesRef>()),
        ].map(([tutorId, ref]) => [tutorId, ref.seriesId]),
      );
      let created = 0;
      try {
        for (let i = 1; i <= HORIZON_MONTHS_AHEAD; i++) {
          const target = normalizeMonth(year, month + i);
          const key = monthKey(target.year, target.month);
          if (key < startKey) continue;
          if (months.has(i)) continue;
          const slots = governingSlotsForMonth(student, `${key}-01`);
          if (slots === null) {
            result.monthsSkippedNoSchedule++;
            continue;
          }
          const built = buildTutoringMonthSessions({
            student,
            slots,
            tutorNameById,
            year: target.year,
            month: target.month,
            notBefore: key === startKey ? start : undefined,
            seriesIdByTutor,
          });
          if (built.length === 0) continue;
          await this.sessions.createSessions(built);
          created += built.length;
          months.add(i);
          for (const s of built) seriesIdByTutor.set(s.tutor_id, s.series_id!);
        }
      } catch (err) {
        this.logger.error(
          `Horizon fill failed for student ${student.id}: ${(err as Error).message}`,
        );
      }
      if (created > 0) {
        result.studentsFilled++;
        result.sessionsCreated += created;
      }
    }

    if (!opts.studentId) {
      result.groupSessionsCreated = await this.rollGroups(
        groupBySeries,
        monthIndexOf,
        year,
        month,
      );
    }

    if (opts.lock) {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await this.billing.releaseLock(`lock#horizon#${yesterday}`);
    }
    this.logger.log(
      `Horizon fill ${dayKey}: ${result.studentsFilled} student(s), ` +
        `${result.sessionsCreated} session(s), ${result.groupSessionsCreated} group session(s), ` +
        `${result.monthsSkippedNoSchedule} month(s) awaiting a schedule.`,
    );
    return result;
  }

  private isEligible(student: Student): boolean {
    return (
      student.status === STUDENT_STATUS.ACTIVE_STUDENT &&
      !!student.auto_renew &&
      !!student.schedule?.length &&
      !!student.package_start_date
    );
  }

  /**
   * Rolls every still-running group series month by month through the
   * horizon: a series with a PENDING session in month i-1 and nothing in
   * month i gets month i generated from its latest occurrence (created
   * sessions feed the next step, so a series chains across the window).
   */
  private async rollGroups(
    groupBySeries: Map<string, Session[]>,
    monthIndexOf: (iso: string) => number,
    year: number,
    month: number,
  ): Promise<number> {
    let created = 0;
    for (let i = 1; i <= HORIZON_MONTHS_AHEAD; i++) {
      const target = normalizeMonth(year, month + i);
      for (const list of groupBySeries.values()) {
        const prev = list.filter(
          (s) => monthIndexOf(s.start_datetime) === i - 1,
        );
        if (prev.length === 0) continue;
        if (list.some((s) => monthIndexOf(s.start_datetime) === i)) continue;
        if (!prev.some((s) => s.status === PENDING_STATUS)) continue;
        const latest = prev.reduce((a, b) =>
          a.start_datetime > b.start_datetime ? a : b,
        );
        const built = buildGroupRollSessions(latest, target.year, target.month);
        if (built.length === 0) continue;
        await this.sessions.createSessions(built);
        list.push(...built);
        created += built.length;
      }
    }
    return created;
  }
}
