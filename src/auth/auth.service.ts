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
  ChangePasswordCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { ResponseDto } from './dto/response.dto';

@Injectable()
export class AuthService {
  private client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  private clientId = process.env.COGNITO_CLIENT_ID!;
  private clientSecret = process.env.COGNITO_CLIENT_SECRET!;
  private userPoolId = process.env.COGNITO_USER_POOL_ID!;
  // Uses the default AWS credential provider chain — the ECS task role in
  // production — instead of static IAM-user keys passed as env vars.
  private adminClient = new CognitoIdentityProviderClient({
    region: 'us-east-1',
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
    id: string,
  ): Promise<ResponseDto | UserType> {
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:contact_id', Value: id },
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

  async changePassword(
    accessToken: string,
    previousPassword: string,
    proposedPassword: string,
  ): Promise<ResponseDto> {
    const command = new ChangePasswordCommand({
      AccessToken: accessToken,
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword,
    });
    try {
      await this.client.send(command);
      return { message: 'Password changed successfully.', success: true };
    } catch (error) {
      Logger.error(error);
      return { message: this.friendlyError(error), success: false };
    }
  }

  async forgotPassword(email: string): Promise<ResponseDto> {
    const command = new ForgotPasswordCommand({
      ClientId: this.clientId,
      Username: email,
      SecretHash: this.getSecretHash(email),
    });
    try {
      await this.client.send(command);
      return {
        message:
          'If an account exists for that email, a reset code has been sent.',
        success: true,
      };
    } catch (error) {
      Logger.error(error);
      return { message: this.friendlyError(error), success: false };
    }
  }

  async confirmForgotPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<ResponseDto> {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: this.clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
      SecretHash: this.getSecretHash(email),
    });
    try {
      await this.client.send(command);
      return { message: 'Password reset successfully.', success: true };
    } catch (error) {
      Logger.error(error);
      return { message: this.friendlyError(error), success: false };
    }
  }

  /** Maps common Cognito errors to user-friendly messages. */
  private friendlyError(error: unknown): string {
    const name = (error as { name?: string })?.name ?? '';
    switch (name) {
      case 'NotAuthorizedException':
        return 'Current password is incorrect.';
      case 'InvalidPasswordException':
        return 'New password does not meet the requirements.';
      case 'LimitExceededException':
        return 'Too many attempts, please try again later.';
      case 'CodeMismatchException':
      case 'ExpiredCodeException':
        return 'Invalid or expired code. Please request a new one.';
      case 'UserNotFoundException':
        return 'If an account exists for that email, a reset code has been sent.';
      default:
        return 'Request failed. Please try again.';
    }
  }
}
