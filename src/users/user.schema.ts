import * as dynamoose from 'dynamoose';

export class User {
  UserId: string;
  Password: string;
}

export const UserSchema = new dynamoose.Schema({
  UserId: {
    type: String,
    hashKey: true,
  },
  Password: String,
});

export const UserModel = dynamoose.model('BTCTutoring-User-Table', UserSchema);
