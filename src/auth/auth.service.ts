import { Injectable } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  private clientId = process.env.COGNITO_CLIENT_ID!;
  private clientSecret = process.env.COGNITO_CLIENT_SECRET!;

  private getSecretHash(username: string): string {
    return crypto
      .createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }

  async signup(email: string, password: string) {
    const command = new SignUpCommand({
      ClientId: this.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
      SecretHash: this.getSecretHash(email),
    });
    await this.client.send(command);
    return {
      message:
        'Signup successful. Please check your email for confirmation code.',
    };
  }

  async confirm(email: string, code: string) {
    const command = new ConfirmSignUpCommand({
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      SecretHash: this.getSecretHash(email),
    });
    await this.client.send(command);
    return { message: 'Account confirmed successfully.' };
  }

  async login(email: string, password: string) {
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: this.getSecretHash(email),
      },
    });
    const response = await this.client.send(command);
    return {
      idToken: response.AuthenticationResult?.IdToken,
      accessToken: response.AuthenticationResult?.AccessToken,
      refreshToken: response.AuthenticationResult?.RefreshToken,
    };
  }
}
