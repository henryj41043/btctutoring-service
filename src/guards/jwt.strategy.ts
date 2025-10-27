import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as jwksRsa from 'jwks-rsa';
import { CognitoJwtPayload, JwtPayload } from 'aws-jwt-verify/jwt-model';
import { User } from '../models/user.model';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import express from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      }),
      issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  private verifier = CognitoJwtVerifier.create({
    userPoolId: `${process.env.COGNITO_USER_POOL_ID}`,
    tokenUse: 'id',
    clientId: `${process.env.COGNITO_CLIENT_ID}`,
  });

  async validate(
    req: express.Request,
    accessPayload: JwtPayload,
  ): Promise<User> {
    const idToken: string = req.headers['X-ID-Token'] as string;
    return await this.verifier
      .verify(idToken)
      .then((idPayload: CognitoJwtPayload) => {
        if (accessPayload.username !== idPayload['cognito:username']) {
          Logger.error('Id Token does not match Access Token');
          throw new Error('Token Mismatch');
        } else {
          return {
            username: accessPayload.username,
            groups: accessPayload['cognito:groups'],
            email: idPayload.email,
          } as User;
        }
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        throw err;
      });
  }
}
