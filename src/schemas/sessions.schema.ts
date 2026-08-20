import * as dynamoose from 'dynamoose';

export const SessionsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  type: String,
  end_datetime: String,
  notes: String,
  start_datetime: String,
  status: String,
  student_id: String,
  student_name: String,
  tutor_id: String,
  tutor_name: String,
  series_id: String,
  // Last time the session's notes were emailed to the parent (display only —
  // deliberate re-sends are allowed).
  notes_emailed_at: String,
});
