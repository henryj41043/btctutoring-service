/**
 * Canonical student `status` values. Kept in one place so the auto-renew job,
 * the onboarding view, and any future status-keyed logic agree on the literals
 * (the free-form schema string had drifted between 'Active' and 'Active Student').
 */
export const STUDENT_STATUS = {
  ONBOARDING: 'Onboarding',
  ACTIVE_STUDENT: 'Active Student',
} as const;
