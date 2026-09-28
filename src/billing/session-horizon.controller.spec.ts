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

  describe('rebuild from a date', () => {
    it('passes the date through for one student', async () => {
      await controller.fill(reqAs(admin), 's-1', '2026-10-14');
      expect(horizon.fillHorizon).toHaveBeenCalledWith(expect.any(Date), {
        lock: false,
        studentId: 's-1',
        rebuildFrom: '2026-10-14',
      });
    });

    it('needs a student', async () => {
      await expect(
        controller.fill(reqAs(admin), undefined, '2026-10-14'),
      ).rejects.toThrow('from requires a student.');
      await expect(
        controller.fill(reqAs(admin), '', '2026-10-14'),
      ).rejects.toThrow('from requires a student.');
      expect(horizon.fillHorizon).not.toHaveBeenCalled();
    });

    it.each([
      ['2026-10'],
      ['10/14/2026'],
      ['2026-13-40'],
      ['2026-10-14T00:00'],
    ])('rejects the date %s', async (from) => {
      await expect(controller.fill(reqAs(admin), 's-1', from)).rejects.toThrow(
        'from must be formatted YYYY-MM-DD.',
      );
      expect(horizon.fillHorizon).not.toHaveBeenCalled();
    });

    it('an empty date is an ordinary fill', async () => {
      await controller.fill(reqAs(admin), 's-1', '');
      expect(horizon.fillHorizon).toHaveBeenCalledWith(expect.any(Date), {
        lock: false,
        studentId: 's-1',
      });
    });

    it('non-admin is unauthorized before any validation', async () => {
      await expect(
        controller.fill(reqAs(tutor), undefined, 'nope'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
