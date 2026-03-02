import { Injectable, Logger } from '@nestjs/common';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  AdminCreateUserCommand,
  ChallengeNameType,
  RespondToAuthChallengeCommand,
  AuthenticationResultType,
  UserType,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { ResponseDto } from './dto/response.dto';

@Injectable()
export class AuthService {
  private client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  private clientId = process.env.COGNITO_CLIENT_ID!;
  private clientSecret = process.env.COGNITO_CLIENT_SECRET!;
  private userPoolId = process.env.COGNITO_USER_POOL_ID!;
  private adminClient = new CognitoIdentityProviderClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: `${process.env.AWS_ACCESS_KEY_ID}`,
      secretAccessKey: `${process.env.AWS_SECRET_ACCESS_KEY}`,
    },
  });

  private getSecretHash(username: string): string {
    return crypto
      .createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }

  async signup(email: string, password: string): Promise<ResponseDto> {
    const command = new SignUpCommand({
      ClientId: this.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
      SecretHash: this.getSecretHash(email),
    });
    try {
      await this.client.send(command);
      return {
        message:
          'Signup successful. Please check your email for confirmation code.',
      } as ResponseDto;
    } catch (error) {
      Logger.error(error);
      return {
        message: 'Signup failed.',
      } as ResponseDto;
    }
  }

  async confirm(email: string, code: string): Promise<ResponseDto> {
    const command = new ConfirmSignUpCommand({
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      SecretHash: this.getSecretHash(email),
    });
    try {
      await this.client.send(command);
      return { message: 'Account confirmed successfully.' } as ResponseDto;
    } catch (error) {
      Logger.error(error);
      return { message: 'Account confirmed failed.' } as ResponseDto;
    }
  }

  async login(
    email: string,
    password: string,
  ): Promise<ResponseDto | AuthenticationResultType> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
        SECRET_HASH: this.getSecretHash(email),
      },
    });
    try {
      const response: InitiateAuthCommandOutput =
        await this.client.send(command);
      if (response.ChallengeName === ChallengeNameType.NEW_PASSWORD_REQUIRED) {
        return {
          message: response.ChallengeName,
          session: response.Session,
        } as ResponseDto;
      }
      return response.AuthenticationResult!;
    } catch (error) {
      Logger.error(error);
      return { message: 'Login failed.' } as ResponseDto;
    }
  }

  async respondToNewPasswordChallenge(
    username: string,
    newPassword: string,
    session: string,
  ): Promise<ResponseDto | AuthenticationResultType> {
    const command = new RespondToAuthChallengeCommand({
      ChallengeName: ChallengeNameType.NEW_PASSWORD_REQUIRED,
      ClientId: this.clientId,
      ChallengeResponses: {
        USERNAME: username,
        NEW_PASSWORD: newPassword,
        SECRET_HASH: this.getSecretHash(username),
      },
      Session: session,
    });
    try {
      const response = await this.client.send(command);
      return response.AuthenticationResult!;
    } catch (error) {
      Logger.error(error);
      return { message: 'Reset password failed.' } as ResponseDto;
    }
  }

  async adminCreateUser(
    email: string,
    group: string,
  ): Promise<ResponseDto | UserType> {
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      DesiredDeliveryMediums: ['EMAIL'],
    });
    try {
      const createUserResponse = await this.adminClient.send(createUserCommand);
      const user: UserType = createUserResponse.User!;
      const addUserToGroupCommand = new AdminAddUserToGroupCommand({
        UserPoolId: this.userPoolId,
        Username: user.Username,
        GroupName: group,
      });
      await this.adminClient.send(addUserToGroupCommand);
      return createUserResponse.User!;
    } catch (error) {
      Logger.error(error);
      return { message: 'Create user failed.' } as ResponseDto;
    }
  }

  async adminDeleteUser(id: string): Promise<ResponseDto> {
    const deleteUserCommand = new AdminDeleteUserCommand({
      UserPoolId: this.userPoolId,
      Username: id,
    });
    try {
      await this.adminClient.send(deleteUserCommand);
      return { message: 'Deleted user successfully.' } as ResponseDto;
    } catch (error) {
      Logger.error(error);
      return { message: 'Delete user failed.' } as ResponseDto;
    }
  }
}
