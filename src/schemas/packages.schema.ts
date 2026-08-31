import * as dynamoose from 'dynamoose';

export const PackagesSchema = new dynamoose.Schema({
  // The package NAME (e.g. 'Apex') — the permanent identifier. Students store
  // this exact string in their `package` / `pending_package` fields, so it can
  // never change after create.
  id: {
    type: String,
    hashKey: true,
  },
  monthlyCost: Number,
  sessionsPerWeek: Number,
  sessionLengthMin: Number,
  // Retired packages hide from selects but keep resolving for students
  // still on them. The ONLY mutable attribute on a row.
  retired: Boolean,
  created_at: String,
  updated_at: String,
});
