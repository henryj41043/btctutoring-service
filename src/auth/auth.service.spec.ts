import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  ChangePasswordCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { AuthService } from './auth.service';
import { AuthenticationResultType } from '@aws-sdk/client-cognito-identity-provider';
import { ResponseDto } from './dto/response.dto';

// AuthService reads these at construction time.
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_CLIENT_SECRET = 'test-client-secret';
process.env.COGNITO_USER_POOL_ID = 'test-pool-id';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

const named = (name: string): Error => Object.assign(new Error(name), { name });

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    cognitoMock.reset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('signup', () => {
    it('returns a success message and includes a SecretHash', async () => {
      cognitoMock.on(SignUpCommand).resolves({});
      const res = await service.signup('a@b.com', 'Pass1!');
      expect(res.message).toMatch(/Signup successful/);
      const call = cognitoMock.commandCalls(SignUpCommand)[0];
      expect(call.args[0].input.SecretHash).toEqual(expect.any(String));
    });

    it('returns a failure message when Cognito throws', async () => {
      cognitoMock.on(SignUpCommand).rejects(new Error('boom'));
      await expect(service.signup('a@b.com', 'Pass1!')).resolves.toEqual({
        message: 'Signup failed.',
      });
    });
  });

  describe('confirm', () => {
    it('confirms an account', async () => {
      cognitoMock.on(ConfirmSignUpCommand).resolves({});
      await expect(service.confirm('a@b.com', '123')).resolves.toEqual({
        message: 'Account confirmed successfully.',
      });
    });

    it('returns a failure message on error', async () => {
      cognitoMock.on(ConfirmSignUpCommand).rejects(new Error('boom'));
      await expect(service.confirm('a@b.com', '123')).resolves.toEqual({
        message: 'Account confirmed failed.',
      });
    });
  });

  describe('login', () => {
    it('returns the authentication result on success', async () => {
      const auth: AuthenticationResultType = { AccessToken: 'token' };
      cognitoMock
        .on(InitiateAuthCommand)
        .resolves({ AuthenticationResult: auth });
      await expect(service.login('a@b.com', 'Pass1!')).resolves.toEqual(auth);
    });

    it('returns the challenge + session when a new password is required', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'sess-123',
      });
      const res = (await service.login('a@b.com', 'Pass1!')) as ResponseDto;
      expect(res).toEqual({
        message: 'NEW_PASSWORD_REQUIRED',
        session: 'sess-123',
      });
    });

    it('returns a failure message on error', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new Error('boom'));
      await expect(service.login('a@b.com', 'Pass1!')).resolves.toEqual({
        message: 'Login failed.',
      });
    });
  });

  describe('respondToNewPasswordChallenge', () => {
    it('returns the authentication result', async () => {
      const auth: AuthenticationResultType = { AccessToken: 'token' };
      cognitoMock
        .on(RespondToAuthChallengeCommand)
        .resolves({ AuthenticationResult: auth });
      await expect(
        service.respondToNewPasswordChallenge('a@b.com', 'New1!', 'sess'),
      ).resolves.toEqual(auth);
    });

    it('returns a failure message on error', async () => {
      cognitoMock.on(RespondToAuthChallengeCommand).rejects(new Error('boom'));
      await expect(
        service.respondToNewPasswordChallenge('a@b.com', 'New1!', 'sess'),
      ).resolves.toEqual({ message: 'Reset password failed.' });
    });
  });

  describe('adminCreateUser', () => {
    it('creates a user and adds them to the group', async () => {
      const user = { Username: 'a@b.com' };
      cognitoMock.on(AdminCreateUserCommand).resolves({ User: user });
      cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
      await expect(
        service.adminCreateUser('a@b.com', 'Tutors', 'contact-1'),
      ).resolves.toEqual(user);
      expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(
        1,
      );
    });

    it('returns a failure message on error', async () => {
      cognitoMock.on(AdminCreateUserCommand).rejects(new Error('boom'));
      await expect(
        service.adminCreateUser('a@b.com', 'Tutors', 'contact-1'),
      ).resolves.toEqual({ message: 'Create user failed.' });
    });
  });

  describe('adminDeleteUser', () => {
    it('deletes a user', async () => {
      cognitoMock.on(AdminDeleteUserCommand).resolves({});
      await expect(service.adminDeleteUser('a@b.com')).resolves.toEqual({
        message: 'Deleted user successfully.',
      });
    });

    it('returns a failure message on error', async () => {
      cognitoMock.on(AdminDeleteUserCommand).rejects(new Error('boom'));
      await expect(service.adminDeleteUser('a@b.com')).resolves.toEqual({
        message: 'Delete user failed.',
      });
    });
  });

  describe('changePassword', () => {
    it('succeeds', async () => {
      cognitoMock.on(ChangePasswordCommand).resolves({});
      await expect(
        service.changePassword('token', 'Old1!', 'New1!'),
      ).resolves.toEqual({
        message: 'Password changed successfully.',
        success: true,
      });
    });

    it.each([
      ['NotAuthorizedException', 'Current password is incorrect.'],
      [
        'InvalidPasswordException',
        'New password does not meet the requirements.',
      ],
      ['LimitExceededException', 'Too many attempts, please try again later.'],
      [
        'CodeMismatchException',
        'Invalid or expired code. Please request a new one.',
      ],
      [
        'ExpiredCodeException',
        'Invalid or expired code. Please request a new one.',
      ],
      [
        'UserNotFoundException',
        'If an account exists for that email, a reset code has been sent.',
      ],
      ['SomethingElse', 'Request failed. Please try again.'],
    ])('maps %s to a friendly message', async (errName, message) => {
      cognitoMock.on(ChangePasswordCommand).rejects(named(errName));
      await expect(
        service.changePassword('token', 'Old1!', 'New1!'),
      ).resolves.toEqual({ message, success: false });
    });

    it('falls back to the generic message when the error has no name', async () => {
      const nameless = new Error('weird');
      (nameless as { name?: string }).name = undefined;
      cognitoMock.on(ChangePasswordCommand).rejects(nameless);
      await expect(
        service.changePassword('token', 'Old1!', 'New1!'),
      ).resolves.toEqual({
        message: 'Request failed. Please try again.',
        success: false,
      });
    });
  });

  describe('forgotPassword', () => {
    it('succeeds', async () => {
      cognitoMock.on(ForgotPasswordCommand).resolves({});
      const res = await service.forgotPassword('a@b.com');
      expect(res.success).toBe(true);
    });

    it('returns a friendly error on failure', async () => {
      cognitoMock
        .on(ForgotPasswordCommand)
        .rejects(named('LimitExceededException'));
      await expect(service.forgotPassword('a@b.com')).resolves.toEqual({
        message: 'Too many attempts, please try again later.',
        success: false,
      });
    });
  });

  describe('confirmForgotPassword', () => {
    it('succeeds', async () => {
      cognitoMock.on(ConfirmForgotPasswordCommand).resolves({});
      await expect(
        service.confirmForgotPassword('a@b.com', '123', 'New1!'),
      ).resolves.toEqual({
        message: 'Password reset successfully.',
        success: true,
      });
    });

    it('returns a friendly error on failure', async () => {
      cognitoMock
        .on(ConfirmForgotPasswordCommand)
        .rejects(named('CodeMismatchException'));
      await expect(
        service.confirmForgotPassword('a@b.com', '123', 'New1!'),
      ).resolves.toEqual({
        message: 'Invalid or expired code. Please request a new one.',
        success: false,
      });
    });
  });
});
