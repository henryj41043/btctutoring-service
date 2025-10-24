import { Injectable, Logger } from '@nestjs/common';
import { User } from '../models/user.model';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoJwtPayload } from 'aws-jwt-verify/jwt-model';

@Injectable()
export class UserService {
  private verifier = CognitoJwtVerifier.create({
    userPoolId: `${process.env.COGNITO_USER_POOL_ID}`,
    tokenUse: 'id',
    clientId: `${process.env.COGNITO_CLIENT_ID}`,
  });

  async getUser(user: User, idToken: string) {
    return this.verifier
      .verify(idToken)
      .then((payload: CognitoJwtPayload) => {
        if (user.username !== payload['cognito:username']) {
          Logger.error('Id Token does not match Access Token');
          return Promise.reject(new Error('Id does not match access'));
        } else {
          return {
            username: user.username,
            groups: user.groups,
            email: payload.email,
          };
        }
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }
}
