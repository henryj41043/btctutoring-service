export class Team {
  id?: string;
  name: string;
  /** Contact id of the Lead Tutor who heads the team. */
  lead_contact_id: string;
  /** Contact ids of the tutor members (excludes the lead). */
  member_contact_ids: string[];
}
