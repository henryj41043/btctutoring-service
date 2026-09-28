import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StudentsService } from '../students/students.service';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { BillingService } from './billing.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { Session, SessionType } from '../models/session.model';
import { dateKey, easternDateKey, easternSlotToUtc } from './eastern-time';
import { PackagePromotionService } from './package-promotion.service';
import { ServiceEndService } from './service-end.service';
import { STUDENT_STATUS } from '../students/student-status';
import {
  buildGroupRollSessions,
  buildTutoringSegmentSessions,
  HORIZON_MONTHS_AHEAD,
  normalizeMonth,
  PENDING_STATUS,
  scheduleSegmentsForMonth,
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
    private readonly serviceEnd: ServiceEndService,
    private readonly promotion: PackagePromotionService,
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

    if (opts.lock) {
      // Scheduled package changes due today become current first, so the
      // fill below reads each student's new package and schedule.
      await this.promotion.promoteDueChanges(now).catch((err: Error) => {
        this.logger.error(`Package promotions failed: ${err.message}`);
      });
      // Ended students leave Active (and lose their later sessions) BEFORE
      // the fill decides who is eligible. A failure never blocks the fill.
      await this.serviceEnd.applyServiceEnds(now).catch((err: Error) => {
        this.logger.error(`Service ends failed: ${err.message}`);
      });
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

    // Buckets: tutoring days (Eastern dates) per student, latest series per
    // (student, tutor), and group sessions per series.
    const tutoringDays = new Map<string, Set<string>>();
    const seriesByStudent = new Map<string, Map<string, SeriesRef>>();
    const groupBySeries = new Map<string, Session[]>();
    for (const s of windowSessions) {
      const idx = monthIndexOf(s.start_datetime ?? '');
      if (idx < 0) continue;
      if (s.type === SessionType.TUTORING && s.student_id) {
        let days = tutoringDays.get(s.student_id);
        if (!days) tutoringDays.set(s.student_id, (days = new Set()));
        days.add(easternDateKey(new Date(s.start_datetime)));
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

    const todayKey = dateKey(year, month, now.getDate());
    for (const student of students) {
      if (!this.isEligible(student)) continue;
      const days = tutoringDays.get(student.id!) ?? new Set<string>();
      const seriesIdByTutor = new Map<string, string>(
        [
          ...(seriesByStudent.get(student.id!) ?? new Map<string, SeriesRef>()),
        ].map(([tutorId, ref]) => [tutorId, ref.seriesId]),
      );
      let created = 0;
      try {
        for (let i = 0; i <= HORIZON_MONTHS_AHEAD; i++) {
          const target = normalizeMonth(year, month + i);
          const segments = scheduleSegmentsForMonth(
            student,
            target.year,
            target.month,
          );
          for (const segment of segments) {
            // The current month belongs to the app's rest-of-month
            // generation: only a stretch that STARTS today or later (a
            // change landing this month) is filled here, so a session an
            // admin deleted from the running schedule never comes back.
            if (i === 0 && segment.from < todayKey) continue;
            // Idempotent per stretch: any tutoring session inside it (even
            // a cancelled one) means it was generated already.
            if (this.hasDayWithin(days, segment.from, segment.to)) continue;
            if (segment.slots === null) {
              result.monthsSkippedNoSchedule++;
              continue;
            }
            const built = buildTutoringSegmentSessions(segment, {
              student,
              tutorNameById,
              year: target.year,
              month: target.month,
              seriesIdByTutor,
            });
            if (built.length === 0) continue;
            await this.sessions.createSessions(built);
            created += built.length;
            for (const s of built) {
              days.add(easternDateKey(new Date(s.start_datetime)));
              seriesIdByTutor.set(s.tutor_id, s.series_id!);
            }
          }
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

  private hasDayWithin(days: Set<string>, from: string, to: string): boolean {
    for (const day of days) {
      if (day >= from && day <= to) return true;
    }
    return false;
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
