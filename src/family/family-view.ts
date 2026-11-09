import { Contact } from '../models/contact.model';
import { ScheduleSlot, Student } from '../models/student.model';
import { availableMakeupMinutes } from '../students/makeup-ledger';
import { studentVisibleToTutor } from '../students/student-visibility';
import { STUDENT_STATUS } from '../students/student-status';

/**
 * The read-only family page for tutors (client 2026-11-09): the parent's
 * contact details and, per student the viewer may see, the schedule and the
 * make-up time owed. Built field by field from a whitelist, so billing,
 * scholarship, notes, documents and payment data can never leak through.
 */

/** A schedule slot as the family page shows it, with the slot tutor's name. */
export interface FamilySlot {
  weekday: string;
  start_time: string;
  end_time: string;
  tutor_id?: string;
  tutor_name?: string;
}

export interface FamilyStudent {
  id: string;
  name: string;
  status: string;
  package: string;
  assigned_tutor_id?: string;
  tutor_name?: string;
  schedule: FamilySlot[];
  /** Make-up minutes the student can still use today (expired lots excluded). */
  make_up_available: number;
  /** Make-up minutes already booked on the calendar but not yet held. */
  make_up_pending: number;
  make_up_never_expire: boolean;
}

export interface FamilyView {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  students: FamilyStudent[];
}

/** Who is looking: an admin sees every student; anyone else their scope. */
export interface FamilyViewer {
  isAdmin: boolean;
  contactId: string;
  /** Tutors whose students the viewer also sees (a lead's team, transitive). */
  teamTutorIds: string[];
  /** The Head Tutor: every current student of every family (client 2026-11-09). */
  allTutors?: boolean;
}

/** Statuses a non-admin sees: the students on someone's roster now. */
const CURRENT_STATUSES: string[] = [
  STUDENT_STATUS.ACTIVE_STUDENT,
  STUDENT_STATUS.ONBOARDING,
];

/** True when the viewer may see this student on the family page. */
export function studentInScope(
  student: Student,
  viewer: FamilyViewer,
): boolean {
  if (viewer.isAdmin) return true;
  if (!CURRENT_STATUSES.includes(student.status ?? '')) return false;
  if (viewer.allTutors) return true;
  return [viewer.contactId, ...viewer.teamTutorIds]
    .filter(Boolean)
    .some((tutorId) => studentVisibleToTutor(student, tutorId));
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * The family page payload. Students out of the viewer's scope are left out;
 * the parent's details always show. `pendingByStudent` holds booked make-up
 * minutes, `tutorNames` display names by contact id.
 */
export function buildFamilyView(
  contact: Contact,
  students: Student[],
  viewer: FamilyViewer,
  pendingByStudent: Map<string, number>,
  tutorNames: Map<string, string>,
  now: Date = new Date(),
): FamilyView {
  const slot = (s: ScheduleSlot): FamilySlot => ({
    weekday: text(s?.weekday),
    start_time: text(s?.start_time),
    end_time: text(s?.end_time),
    ...(s?.tutor_id
      ? { tutor_id: s.tutor_id, tutor_name: tutorNames.get(s.tutor_id) }
      : {}),
  });
  const shown = students
    .filter((s) => !!s.id && studentInScope(s, viewer))
    .sort((a, b) => text(a.name).localeCompare(text(b.name)));
  return {
    id: text(contact.id),
    first_name: text(contact.first_name),
    last_name: text(contact.last_name),
    email: text(contact.email),
    phone_number: text(contact.phone_number),
    address_line1: text(contact.address_line1),
    address_line2: text(contact.address_line2),
    city: text(contact.city),
    state: text(contact.state),
    zip: text(contact.zip),
    students: shown.map((s) => ({
      id: s.id as string,
      name: text(s.name),
      status: text(s.status),
      package: text(s.package),
      assigned_tutor_id: s.assigned_tutor_id,
      tutor_name: s.assigned_tutor_id
        ? tutorNames.get(s.assigned_tutor_id)
        : undefined,
      schedule: (s.schedule ?? []).map(slot),
      make_up_available: availableMakeupMinutes(s, now),
      make_up_pending: pendingByStudent.get(s.id as string) ?? 0,
      make_up_never_expire: !!s.make_up_never_expire,
    })),
  };
}

/** Every tutor id the page needs a name for (assigned and per-slot). */
export function tutorIdsOf(students: Student[]): string[] {
  const ids = students.flatMap((s) => [
    s.assigned_tutor_id,
    ...(s.schedule ?? []).map((slot) => slot?.tutor_id),
  ]);
  return [...new Set(ids.filter((id): id is string => !!id))];
}
