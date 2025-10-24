import * as dynamoose from 'dynamoose';

export const SessionsSchema = new dynamoose.Schema({
  id: {
    type: String,
    hashKey: true,
  },
  tutor: String,
  student: String,
  completed: Boolean,
  end: String,
  makeup: Boolean,
  start: String,
});
