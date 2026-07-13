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
  onboarding_complete: Boolean,
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
  // Mid-month package change: the old package's prorated portion for the change
  // month, applied on top of the new package's charge only in that month.
  mid_month_prior_charge: Number,
  mid_month_change_period: String,
  // Deprecated: replaced by package-driven scheduling. Kept so reads of
  // pre-existing records don't error.
  available_minutes: Number,
});
