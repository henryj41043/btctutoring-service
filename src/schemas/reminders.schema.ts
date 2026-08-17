import * as dynamoose from 'dynamoose';

export const RemindersSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  title: String,
  message: String,
  // Eastern wall date 'YYYY-MM-DD'; the 9am ET cron emails reminders due today.
  date: String,
  all_admins: Boolean,
  recipient_ids: {
    type: Array,
    schema: [String],
  },
  // Optional linked contact the reminder is about.
  contact_id: String,
  // Set once the morning-of digest has been sent — the fire-once flag.
  sent_at: String,
  created_by: String,
  // Optional 'due by' wall date 'YYYY-MM-DD' (display-only).
  due_date: String,
  // Absent = one-time; recurring reminders advance `date` after each send.
  recurrence: {
    type: String,
    enum: ['weekly', 'monthly'],
  },
  // ISO completion stamp — one-time reminders only.
  completed_at: String,
});
