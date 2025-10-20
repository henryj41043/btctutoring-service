import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as jwksRsa from 'jwks-rsa';
import { JwtPayload } from 'aws-jwt-verify/jwt-model';

@Injectable()
export class CognitoIdTokenStrategy extends PassportStrategy(
  Strategy,
  'cognito-id-token',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromHeader('X-ID-Token'),
      ignoreExpiration: false,
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
      }),
      //audience: process.env.COGNITO_CLIENT_ID,
      issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`,
      algorithms: ['RS256'],
    });
  }

  validate(payload: JwtPayload) {
    return {
      username: payload['cognito:username'],
      groups: payload['cognito:groups'],
      email: payload.email,
    };
  }
}
