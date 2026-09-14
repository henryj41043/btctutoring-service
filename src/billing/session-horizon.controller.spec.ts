import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { SessionHorizonController } from './session-horizon.controller';
import { SessionHorizonService } from './session-horizon.service';
import { User } from '../models/user.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'contact-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'contact-tutor',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

describe('SessionHorizonController', () => {
  let controller: SessionHorizonController;
  const horizon = { fillHorizon: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionHorizonController],
      providers: [{ provide: SessionHorizonService, useValue: horizon }],
    }).compile();
    controller = module.get(SessionHorizonController);
    horizon.fillHorizon.mockResolvedValue({ sessionsCreated: 3 });
  });

  it('admin fills the whole horizon without the lock', async () => {
    const res = await controller.fill(reqAs(admin), undefined);
    expect(horizon.fillHorizon).toHaveBeenCalledWith(expect.any(Date), {
      lock: false,
      studentId: undefined,
    });
    expect(res).toEqual({ sessionsCreated: 3 });
  });

  it('admin fills one student', async () => {
    await controller.fill(reqAs(admin), 's-1');
    expect(horizon.fillHorizon).toHaveBeenCalledWith(expect.any(Date), {
      lock: false,
      studentId: 's-1',
    });
  });

  it('treats an empty student query as the whole horizon', async () => {
    await controller.fill(reqAs(admin), '');
    expect(horizon.fillHorizon.mock.calls[0][1].studentId).toBeUndefined();
  });

  it('non-admin is unauthorized', async () => {
    await expect(controller.fill(reqAs(tutor), 's-1')).rejects.toThrow(
      'Unauthorized',
    );
    expect(horizon.fillHorizon).not.toHaveBeenCalled();
  });

  it('non-admin without groups is unauthorized', async () => {
    await expect(
      controller.fill(
        reqAs({ ...tutor, groups: undefined } as unknown as User),
      ),
    ).rejects.toThrow('Unauthorized');
  });
});
