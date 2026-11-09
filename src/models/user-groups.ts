/**
 * Group predicates shared by controllers. Users belong to exactly one group;
 * Lead Tutors are tutors with extra read-only team visibility, and the Head
 * Tutor is a Lead Tutor with the organization's roster on top, so every
 * tutor self-access branch must accept all three.
 */
export const isTutorLike = (groups: string[]): boolean =>
  groups.includes('Tutors') ||
  groups.includes('LeadTutors') ||
  groups.includes('HeadTutors');

/** Lead Tutors, and the Head Tutor, who leads like one. */
export const isLeadTutor = (groups: string[]): boolean =>
  groups.includes('LeadTutors') || groups.includes('HeadTutors');

/**
 * The Head Tutor (client 2026-11-09): a Lead Tutor who also sees the whole
 * organization's Student Roster and every current family's contact details
 * for parent check-ins, never billing or admin notes. Tutor-like and
 * lead-like, so every tutor and lead path accepts the group.
 */
export const isHeadTutor = (groups: string[]): boolean =>
  groups.includes('HeadTutors');

/**
 * Support Staff (client 2026-10-15): non-tutor employees who only log their
 * own hours. They are NOT tutor-like — no students, no staff list, no
 * make-ups — and may only read, create, edit and delete their own ADMIN
 * (Admin Time) sessions.
 */
export const isSupportStaff = (groups: string[]): boolean =>
  groups.includes('SupportStaff');

/**
 * A CURRENT admin: in the Admins group AND current staff (service Hiring,
 * status Staff). The group alone is not enough — former staff and employment
 * inquiries can still carry it (client 2026-09-14: non-employees showed up
 * as reminder recipients and received admin emails). Mirrors the app's
 * team-picker rule.
 */
export const isCurrentAdmin = (contact: {
  user_group?: string;
  service?: string;
  status?: string;
}): boolean =>
  contact.user_group === 'Admins' &&
  contact.service === 'Hiring' &&
  contact.status === 'Staff';
