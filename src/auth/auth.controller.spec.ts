import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from '../models/user.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};

const reqAs = (
  user: User,
  headers: Record<string, string> = {},
): express.Request => ({ user, headers }) as unknown as express.Request;

describe('AuthController', () => {
  let controller: AuthController;
  let service: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<AuthService>> = {
      signup: jest.fn(),
      confirm: jest.fn(),
      login: jest.fn(),
      respondToNewPasswordChallenge: jest.fn(),
      changePassword: jest.fn(),
      forgotPassword: jest.fn(),
      confirmForgotPassword: jest.fn(),
      adminCreateUser: jest.fn(),
      adminDeleteUser: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: serviceMock }],
    }).compile();
    controller = module.get(AuthController);
    service = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getUser returns the request user', async () => {
    await expect(controller.getUser(reqAs(admin))).resolves.toEqual(admin);
  });

  it('signup delegates to the service', async () => {
    await controller.signup({ email: 'a@b.com', password: 'p' });
    expect(service.signup).toHaveBeenCalledWith('a@b.com', 'p');
  });

  it('confirm delegates to the service', async () => {
    await controller.confirm({ email: 'a@b.com', code: '123' });
    expect(service.confirm).toHaveBeenCalledWith('a@b.com', '123');
  });

  it('login delegates to the service', async () => {
    await controller.login({ email: 'a@b.com', password: 'p' });
    expect(service.login).toHaveBeenCalledWith('a@b.com', 'p');
  });

  it('completeNewPassword delegates to the service', async () => {
    await controller.completeNewPassword({
      username: 'a@b.com',
      newPassword: 'New1!',
      session: 'sess',
    });
    expect(service.respondToNewPasswordChallenge).toHaveBeenCalledWith(
      'a@b.com',
      'New1!',
      'sess',
    );
  });

  describe('changePassword', () => {
    it('strips the Bearer prefix from the access token', async () => {
      await controller.changePassword(
        reqAs(admin, { authorization: 'Bearer abc.def.ghi' }),
        { previousPassword: 'Old1!', proposedPassword: 'New1!' },
      );
      expect(service.changePassword).toHaveBeenCalledWith(
        'abc.def.ghi',
        'Old1!',
        'New1!',
      );
    });

    it('handles a missing authorization header', async () => {
      await controller.changePassword(reqAs(admin, {}), {
        previousPassword: 'Old1!',
        proposedPassword: 'New1!',
      });
      expect(service.changePassword).toHaveBeenCalledWith('', 'Old1!', 'New1!');
    });
  });

  it('forgotPassword delegates to the service', async () => {
    await controller.forgotPassword({ email: 'a@b.com' });
    expect(service.forgotPassword).toHaveBeenCalledWith('a@b.com');
  });

  it('confirmForgotPassword delegates to the service', async () => {
    await controller.confirmForgotPassword({
      email: 'a@b.com',
      code: '123',
      newPassword: 'New1!',
    });
    expect(service.confirmForgotPassword).toHaveBeenCalledWith(
      'a@b.com',
      '123',
      'New1!',
    );
  });

  describe('createUser', () => {
    it('admin creates a user', async () => {
      await controller.createUser(reqAs(admin), {
        email: 'new@b.com',
        group: 'Tutors',
        id: 'contact-1',
      });
      expect(service.adminCreateUser).toHaveBeenCalledWith(
        'new@b.com',
        'Tutors',
        'contact-1',
      );
    });

    it('non-admin is rejected', async () => {
      await expect(
        controller.createUser(reqAs(tutor), {
          email: 'new@b.com',
          group: 'Tutors',
          id: 'contact-1',
        }),
      ).rejects.toThrow('Unauthorized');
      expect(service.adminCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('admin deletes another user', async () => {
      await controller.deleteUser(reqAs(admin), 'someone@b.com');
      expect(service.adminDeleteUser).toHaveBeenCalledWith('someone@b.com');
    });

    it('admin cannot delete themselves', async () => {
      await expect(
        controller.deleteUser(reqAs(admin), admin.email),
      ).rejects.toThrow('Unauthorized');
      expect(service.adminDeleteUser).not.toHaveBeenCalled();
    });

    it('non-admin is rejected', async () => {
      await expect(
        controller.deleteUser(reqAs(tutor), 'someone@b.com'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
