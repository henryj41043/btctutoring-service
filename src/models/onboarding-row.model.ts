/**
 * A denormalized row for the Onboarding page: one student in `Onboarding`
 * status merged with its family's (contact's) name and onboarding dates, so the
 * client renders the table from a single small payload with no client-side join.
 */
export class OnboardingRow {
  id?: string;
  contact_id: string;
  name: string;
  status: string;
  onboarding_complete: boolean;
  contact_name: string;
  inquiry_received?: Date;
  inquiry_note_from_parent?: string;
  consult_date?: Date;
  trial_date?: Date;
  registration_sent?: Date;
  registration_received?: Date;
  scholarship_name?: string;
  scholarship_student?: boolean;
  twenty_five_received?: boolean;
}
