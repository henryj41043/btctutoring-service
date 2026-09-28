import { Injectable, Logger } from '@nestjs/common';
import { StudentsService } from '../students/students.service';
import { Student } from '../models/student.model';
import { STUDENT_STATUS } from '../students/student-status';
import { pendingChangesOf } from '../students/pending-changes';
import { easternDateKey } from './eastern-time';

export interface PromotionRunResult {
  /** Students whose scheduled change(s) became their current package. */
  studentsPromoted: number;
}

/**
 * Applies scheduled package changes on their effective date (daily job). A
 * change may fall on any day, so the 1st-of-month run can't be the only
 * promoter. Everything due on or before today's Eastern date is applied, so
 * a missed run is caught up by the next one. Billing never waits for this:
 * the statement engine prices a scheduled change by its date.
 */
@Injectable()
export class PackagePromotionService {
  private readonly logger = new Logger(PackagePromotionService.name);

  constructor(private readonly students: StudentsService) {}

  async promoteDueChanges(now: Date): Promise<PromotionRunResult> {
    const result: PromotionRunResult = { studentsPromoted: 0 };
    const today = easternDateKey(now);
    const students =
      (await this.students.getStudents()) as unknown as Student[];
    for (const student of students) {
      if (student.status !== STUDENT_STATUS.ACTIVE_STUDENT || !student.id) {
        continue;
      }
      const due = pendingChangesOf(student).some(
        (c) => c.effective.slice(0, 10) <= today,
      );
      if (!due) continue;
      try {
        await this.students.promotePendingChanges(student, today);
        result.studentsPromoted++;
      } catch (err) {
        this.logger.error(
          `Package promotion failed for student ${student.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `Package promotions ${today}: ${result.studentsPromoted} student(s).`,
    );
    return result;
  }
}
