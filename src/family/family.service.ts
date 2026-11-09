import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContactsModel } from '../models/contacts.model';
import { StudentsModel } from '../models/students.model';
import { SessionsModel } from '../models/sessions.model';
import { Contact } from '../models/contact.model';
import { Student } from '../models/student.model';
import { Session, SessionType } from '../models/session.model';
import { User } from '../models/user.model';
import { isHeadTutor, isLeadTutor, isTutorLike } from '../models/user-groups';
import { TeamsService } from '../teams/teams.service';
import { SESSION_STATUS, sessionMinutes } from '../sessions/attendance';
import {
  buildFamilyView,
  FamilyView,
  FamilyViewer,
  studentInScope,
  tutorIdsOf,
} from './family-view';

const reject = (err: Error) => {
  Logger.error(err.message, err);
  return Promise.reject(err);
};

@Injectable()
export class FamilyService {
  constructor(private readonly teamsService: TeamsService) {}

  /**
   * The read-only family page (see family-view.ts). Admins and tutors only;
   * a tutor needs at least one current student of the family in scope, and
   * otherwise gets the same 403 as for a family that does not exist to them.
   */
  async getFamilyView(contactId: string, user: User): Promise<FamilyView> {
    const groups = user.groups ?? [];
    const isAdmin = groups.includes('Admins');
    if (!isAdmin && !(isTutorLike(groups) && user.contact)) {
      Logger.error('Family page refused: not an admin or a tutor');
      throw new ForbiddenException('Unauthorized');
    }
    const viewer: FamilyViewer = {
      isAdmin,
      contactId: user.contact ?? '',
      teamTutorIds:
        !isAdmin && isLeadTutor(groups)
          ? await this.teamsService.resolveTeamTutorIds(user.contact)
          : [],
      allTutors: !isAdmin && isHeadTutor(groups),
    };
    const students = (await StudentsModel.scan({
      contact_id: { eq: contactId },
    })
      .all()
      .exec()
      .catch(reject)) as unknown as Student[];
    const inScope = students.filter((s) => studentInScope(s, viewer));
    if (!isAdmin && inScope.length === 0) {
      Logger.error(`Family ${contactId}: no student in the viewer's scope`);
      throw new ForbiddenException('Unauthorized');
    }
    const contact = (await ContactsModel.get(contactId).catch(
      reject,
    )) as unknown as Contact | undefined;
    if (!contact) {
      throw new NotFoundException('Family not found');
    }
    const [pending, names] = await Promise.all([
      this.pendingMakeupMinutes(inScope),
      this.tutorNames(tutorIdsOf(inScope)),
    ]);
    return buildFamilyView(contact, inScope, viewer, pending, names);
  }

  /** Booked (Pending) make-up minutes per student, for the given students. */
  private async pendingMakeupMinutes(
    students: Student[],
  ): Promise<Map<string, number>> {
    const ids = new Set(students.map((s) => s.id).filter(Boolean));
    const totals = new Map<string, number>();
    if (ids.size === 0) return totals;
    const sessions = (await SessionsModel.scan({
      type: { eq: SessionType.MAKE_UP },
      status: { eq: SESSION_STATUS.PENDING },
    })
      .all()
      .exec()
      .catch(reject)) as unknown as Session[];
    for (const session of sessions) {
      if (!session.student_id || !ids.has(session.student_id)) continue;
      totals.set(
        session.student_id,
        (totals.get(session.student_id) ?? 0) + sessionMinutes(session),
      );
    }
    return totals;
  }

  /** Display names for staff contact ids (a missing one is just left out). */
  private async tutorNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const found = await Promise.all(
      ids.map((id) =>
        (ContactsModel.get(id) as Promise<unknown>).catch(() => undefined),
      ),
    );
    found.forEach((raw, i) => {
      const c = raw as Contact | undefined;
      const name = `${c?.first_name ?? ''} ${c?.last_name ?? ''}`.trim();
      if (name) names.set(ids[i], name);
    });
    return names;
  }
}
