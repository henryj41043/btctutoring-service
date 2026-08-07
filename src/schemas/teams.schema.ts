import * as dynamoose from 'dynamoose';

export const TeamsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  name: String,
  // The Lead Tutor's contact id — the key Lead session visibility resolves on.
  lead_contact_id: String,
  member_contact_ids: {
    type: Array,
    schema: [String],
  },
});
