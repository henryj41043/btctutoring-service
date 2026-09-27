import { Injectable, Logger } from '@nestjs/common';
import { StudentsService } from '../students/students.service';
import { SessionsService } from '../sessions/sessions.service';
import { Student } from '../models/student.model';
import { Session, SessionType } from '../models/session.model';
import { STUDENT_STATUS } from '../students/student-status';
import { PENDING_STATUS } from '../sessions/session-builder';
import { easternSlotToUtc } from './eastern-time';
import { keyOf } from './statement-engine';

export interface ServiceEndResult {
  /** Students moved to their end status. */
  studentsEnded: number;
  /** Pending tutoring sessions removed from after an end date. */
  sessionsDeleted: number;
}

const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Eastern calendar date ('YYYY-MM-DD') of an instant. */
export function easternDateKey(at: Date): string {
  return easternDate.format(at);
}

/** The UTC instant the Eastern day AFTER a 'YYYY-MM-DD' key begins. */
export function dayAfterStartIso(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return easternSlotToUtc(y, m - 1, d + 1, '00:00').toISOString();
}

/**
 * Applies service end dates (daily job). The end date is the LAST day of
 * service, so a student moves to their end status the first morning after
 * it; a missed run is caught up by the next one. Pending tutoring sessions
 * after an end date are removed for every student carrying one — this also
 * repairs a cleanup the app could not finish. Sessions that were held,
 * cancelled or are make-ups are never touched.
 */
@Injectable()
export class ServiceEndService {
  private readonly logger = new Logger(ServiceEndService.name);

  constructor(
    private readonly students: StudentsService,
    private readonly sessions: SessionsService,
  ) {}

  async applyServiceEnds(now: Date): Promise<ServiceEndResult> {
    const result: ServiceEndResult = { studentsEnded: 0, sessionsDeleted: 0 };
    const today = easternDateKey(now);
    const students =
      (await this.students.getStudents()) as unknown as Student[];
    for (const student of students) {
      const end = keyOf(student.service_end_date);
      if (!end || !student.id) continue;
      try {
        result.sessionsDeleted += await this.deleteSessionsAfter(
          student.id,
          end,
        );
        if (student.status === STUDENT_STATUS.ACTIVE_STUDENT && end < today) {
          await this.students.applyServiceEnd(student);
          result.studentsEnded++;
        }
      } catch (err) {
        this.logger.error(
          `Service end failed for student ${student.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Service ends ${today}: ${result.studentsEnded} student(s) ended, ` +
        `${result.sessionsDeleted} session(s) removed.`,
    );
    return result;
  }

  /** Deletes the student's PENDING tutoring sessions after the end date. */
  private async deleteSessionsAfter(
    studentId: string,
    end: string,
  ): Promise<number> {
    const after = (await this.sessions.getSessionsByStudent(studentId, {
      from: dayAfterStartIso(end),
    })) as unknown as Session[];
    const doomed = after.filter(
      (s) =>
        !!s.id &&
        s.type === SessionType.TUTORING &&
        s.status === PENDING_STATUS,
    );
    for (const session of doomed) {
      await this.sessions.deleteSession(session.id!);
    }
    return doomed.length;
  }
}
