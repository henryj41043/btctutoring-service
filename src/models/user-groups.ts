/**
 * Group predicates shared by controllers. Users belong to exactly one group;
 * Lead Tutors are tutors with extra read-only team visibility, so every
 * tutor self-access branch must accept both groups.
 */
export const isTutorLike = (groups: string[]): boolean =>
  groups.includes('Tutors') || groups.includes('LeadTutors');

export const isLeadTutor = (groups: string[]): boolean =>
  groups.includes('LeadTutors');
