import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommandOutput,
  ChangePasswordCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import * as crypto from 'crypto';
import { ResponseDto } from './dto/response.dto';

/** The Cognito groups a user account may belong to. A user must be in exactly one. */
export const VALID_USER_GROUPS = ['Admins', 'Tutors', 'LeadTutors'];

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

  /**
   * Exchanges a refresh token for fresh access/id tokens. Cognito's
   * access/id tokens live 60 minutes; without this the app bounced users to
   * the login page an hour into every workday. The refresh token itself is
   * not rotated (5-day validity), so the response carries no new one.
   */
  async refresh(
    username: string,
    refreshToken: string,
  ): Promise<ResponseDto | AuthenticationResultType> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
        SECRET_HASH: this.getSecretHash(username),
      },
    });
    try {
      const response: InitiateAuthCommandOutput =
        await this.client.send(command);
      if (!response.AuthenticationResult) {
        return { message: 'Refresh failed.' } as ResponseDto;
      }
      return response.AuthenticationResult;
    } catch (error) {
      Logger.error(error);
      return { message: 'Refresh failed.' } as ResponseDto;
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

  /** Rejects unless `group` is one of the valid Cognito groups. */
  private assertValidGroup(group: string): void {
    if (!group || !VALID_USER_GROUPS.includes(group)) {
      throw new BadRequestException(
        'A valid group (Admins, Tutors, or LeadTutors) is required to create a user.',
      );
    }
  }

  /**
   * Creates a Cognito user and assigns their group. A user must belong to a
   * group to access the app, so a missing/invalid group is rejected up front,
   * and if the group assignment fails after the user is created the new user is
   * deleted (rolled back) so we never leave an orphaned, group-less account.
   */
  async adminCreateUser(
    email: string,
    group: string,
    id: string,
  ): Promise<UserType> {
    this.assertValidGroup(group);

    let user: UserType;
    try {
      const createUserResponse = await this.adminClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:contact_id', Value: id },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
      user = createUserResponse.User!;
    } catch (error) {
      Logger.error(error);
      throw new InternalServerErrorException('Create user failed.');
    }

    try {
      await this.adminClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.userPoolId,
          Username: user.Username,
          GroupName: group,
        }),
      );
    } catch (error) {
      Logger.error(error);
      // Roll back: a user with no group would be locked out of the whole app.
      try {
        await this.adminClient.send(
          new AdminDeleteUserCommand({
            UserPoolId: this.userPoolId,
            Username: user.Username,
          }),
        );
      } catch (cleanupError) {
        Logger.error(cleanupError);
      }
      throw new InternalServerErrorException(
        'Failed to assign the user to a group; user creation was rolled back.',
      );
    }

    return user;
  }

  /**
   * Moves an existing user to `group`, keeping them in exactly one group:
   * removes them from every other group they currently belong to, then adds the
   * new one. Used to keep Cognito in sync when an admin changes a contact's group.
   */
  async adminUpdateUserGroup(
    email: string,
    group: string,
  ): Promise<ResponseDto> {
    this.assertValidGroup(group);
    try {
      const current = await this.adminClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: this.userPoolId,
          Username: email,
        }),
      );
      for (const existing of current.Groups ?? []) {
        if (existing.GroupName && existing.GroupName !== group) {
          await this.adminClient.send(
            new AdminRemoveUserFromGroupCommand({
              UserPoolId: this.userPoolId,
              Username: email,
              GroupName: existing.GroupName,
            }),
          );
        }
      }
      await this.adminClient.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: this.userPoolId,
          Username: email,
          GroupName: group,
        }),
      );
      return { message: 'User group updated successfully.', success: true };
    } catch (error) {
      Logger.error(error);
      throw new InternalServerErrorException('Failed to update user group.');
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
