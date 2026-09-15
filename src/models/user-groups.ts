/**
 * Group predicates shared by controllers. Users belong to exactly one group;
 * Lead Tutors are tutors with extra read-only team visibility, so every
 * tutor self-access branch must accept both groups.
 */
export const isTutorLike = (groups: string[]): boolean =>
  groups.includes('Tutors') || groups.includes('LeadTutors');

export const isLeadTutor = (groups: string[]): boolean =>
  groups.includes('LeadTutors');

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
