export class Reminder {
  id?: string;
  title: string;
  message: string;
  /** The reminder's Eastern wall date, 'YYYY-MM-DD'. Emailed the morning of. */
  date: string;
  /** When true the digest goes to every admin; recipient_ids is ignored. */
  all_admins?: boolean;
  /** Individual admin recipients (contact ids) when all_admins is false. */
  recipient_ids?: string[];
  /** ISO timestamp set once the morning-of email has been sent (fire once). */
  sent_at?: string;
  /** Optional linked contact the reminder is about (jump-off in the UI). */
  contact_id?: string;
  /** Contact id of the admin who created the reminder. */
  created_by?: string;
  /** Optional 'due by' wall date 'YYYY-MM-DD'; display-only (table + digest). */
  due_date?: string;
  /** Absent = one-time. Recurring reminders advance `date` after each send. */
  recurrence?: 'weekly' | 'monthly';
  /** ISO timestamp; one-time reminders only (recurring never carry it). */
  completed_at?: string;
}
