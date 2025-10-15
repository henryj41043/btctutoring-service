import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import * as AWS from 'aws-sdk';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (req, rawJwtToken, done) => {
        const cognitoIssuer = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`;
        AWS.config.region = process.env.AWS_REGION;
        done(null, cognitoIssuer);
      },
    });
  }
  validate(payload: Partial<{ sub: string; email: string }>) {
    return { userId: payload.sub, email: payload.email };
  }
}
