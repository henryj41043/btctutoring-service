/**
 * Canonical student `status` values. Kept in one place so the auto-renew job,
 * the onboarding view, and any future status-keyed logic agree on the literals
 * (the free-form schema string had drifted between 'Active' and 'Active Student').
 */
export const STUDENT_STATUS = {
  ONBOARDING: 'Onboarding',
  ACTIVE_STUDENT: 'Active Student',
  PAST_STUDENT: 'Past Student',
  // A family that stopped responding during onboarding — the escape hatch
  // that keeps students from being trapped in Onboarding forever. Inert for
  // billing/auto-renew/rosters (those gate on ACTIVE_STUDENT).
  MIA: 'MIA',
} as const;
