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
  // Every attendance change, oldest first: who, when, why and the make-up
  // minutes moved. Written by the attendance route only.
  attendance_history: {
    type: Array,
    schema: [
      {
        type: Object,
        schema: {
          from: String,
          to: String,
          by: String,
          by_name: String,
          at: String,
          reason: String,
          minutes_delta: Number,
          unrecovered: Number,
        },
      },
    ],
  },
  // GROUP sessions only: the student roster. student_id stays empty; the
  // joined names are denormalized into student_name for display/search.
  participants: {
    type: Array,
    schema: [
      {
        type: Object,
        schema: {
          id: String,
          name: String,
        },
      },
    ],
  },
});
