import * as dynamoose from 'dynamoose';

export const ClientsSchema = new dynamoose.Schema({
  client: {
    type: String,
    hashKey: true,
  },
  duration: Number,
  makeupSessions: Number,
  sessions: Number,
});
