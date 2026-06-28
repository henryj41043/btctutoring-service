import * as dynamoose from 'dynamoose';

export const StudentsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  contact_id: String,
  name: String,
  birthday: String,
  status: String,
  assigned_tutor_id: String,
  package: String,
  scholarship: Boolean,
  schedule: {
    type: Array,
    schema: [
      {
        type: Object,
        schema: {
          weekday: String,
          start_time: String,
          end_time: String,
        },
      },
    ],
  },
  package_start_date: String,
  auto_renew: Boolean,
  custom_monthly_cost: Number,
  custom_sessions_per_week: Number,
  custom_session_length_min: Number,
  make_up_minutes: Number,
  // Deprecated: replaced by package-driven scheduling. Kept so reads of
  // pre-existing records don't error.
  available_minutes: Number,
});
