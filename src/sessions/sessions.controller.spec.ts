import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { User } from '../models/user.model';
import { Session, SessionType } from '../models/session.model';

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
const stranger: User = {
  username: 'stranger',
  email: 'stranger@example.com',
  groups: [],
  contact: 'c-stranger',
};

const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const session = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 's-1',
    type: SessionType.TUTORING,
    end_datetime: '2026-01-01T11:00:00Z',
    notes: '',
    start_datetime: '2026-01-01T10:00:00Z',
    status: 'Pending',
    tutor_id: 'c-tutor',
    tutor_name: 'Tess',
    ...overrides,
  }) as Session;

describe('SessionsController', () => {
  let controller: SessionsController;
  let service: jest.Mocked<SessionsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<SessionsService>> = {
      getSessions: jest.fn(),
      getSessionsByTutor: jest.fn(),
      getSessionsByStudent: jest.fn(),
      getAllSessions: jest.fn(),
      getSessionsBySeries: jest.fn(),
      createSession: jest.fn(),
      createSessions: jest.fn(),
      updateSession: jest.fn(),
      deleteSession: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [{ provide: SessionsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(SessionsController);
    service = module.get(SessionsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSessions routing', () => {
    it('admin + series -> getSessionsBySeries', async () => {
      await controller.getSessions(reqAs(admin), '', '', 'series-1', '', '');
      expect(service.getSessionsBySeries).toHaveBeenCalledWith('series-1');
    });

    it('non-admin + series -> unauthorized', async () => {
      await expect(
        controller.getSessions(reqAs(tutor), '', '', 'series-1', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin + tutor & student -> getSessions', async () => {
      await controller.getSessions(
        reqAs(admin),
        'c-tutor',
        'stu-1',
        '',
        '',
        '',
      );
      expect(service.getSessions).toHaveBeenCalledWith(
        'c-tutor',
        'stu-1',
        undefined,
      );
    });

    it('owning tutor + tutor & student -> getSessions', async () => {
      await controller.getSessions(
        reqAs(tutor),
        'c-tutor',
        'stu-1',
        '',
        '',
        '',
      );
      expect(service.getSessions).toHaveBeenCalledWith(
        'c-tutor',
        'stu-1',
        undefined,
      );
    });

    it('tutor querying another tutor + student -> unauthorized', async () => {
      await expect(
        controller.getSessions(
          reqAs(tutor),
          'other@example.com',
          'stu-1',
          '',
          '',
          '',
        ),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin + tutor only -> getSessionsByTutor', async () => {
      await controller.getSessions(
        reqAs(admin),
        'c-tutor',
        '',
        '',
        '',
        '',
      );
      expect(service.getSessionsByTutor).toHaveBeenCalledWith(
        'c-tutor',
        undefined,
      );
    });

    it('owning tutor + tutor only -> getSessionsByTutor', async () => {
      await controller.getSessions(
        reqAs(tutor),
        'c-tutor',
        '',
        '',
        '',
        '',
      );
      expect(service.getSessionsByTutor).toHaveBeenCalledWith(
        'c-tutor',
        undefined,
      );
    });

    it('tutor querying another tutor -> unauthorized', async () => {
      await expect(
        controller.getSessions(
          reqAs(tutor),
          'other@example.com',
          '',
          '',
          '',
          '',
        ),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin + student only -> getSessionsByStudent', async () => {
      await controller.getSessions(reqAs(admin), '', 'stu-1', '', '', '');
      expect(service.getSessionsByStudent).toHaveBeenCalledWith(
        'stu-1',
        undefined,
      );
    });

    it('non-admin + student only -> unauthorized', async () => {
      await expect(
        controller.getSessions(reqAs(tutor), '', 'stu-1', '', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin + no params -> getAllSessions', async () => {
      await controller.getSessions(reqAs(admin), '', '', '', '', '');
      expect(service.getAllSessions).toHaveBeenCalled();
    });

    it('non-admin + no params -> unauthorized', async () => {
      await expect(
        controller.getSessions(reqAs(stranger), '', '', '', '', ''),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('mutations', () => {
    it('admin creates a session', async () => {
      await controller.createSession(reqAs(admin), session());
      expect(service.createSession).toHaveBeenCalled();
    });

    it('non-admin cannot create a session', async () => {
      await expect(
        controller.createSession(reqAs(tutor), session()),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin batch-creates sessions', async () => {
      await controller.createSessions(reqAs(admin), [session()]);
      expect(service.createSessions).toHaveBeenCalled();
    });

    it('non-admin cannot batch-create sessions', async () => {
      await expect(
        controller.createSessions(reqAs(tutor), [session()]),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin updates any session', async () => {
      await controller.updateSession(
        reqAs(admin),
        session({ tutor_id: 'other@example.com' }),
      );
      expect(service.updateSession).toHaveBeenCalled();
    });

    it('owning tutor updates their own session', async () => {
      await controller.updateSession(
        reqAs(tutor),
        session({ tutor_id: 'c-tutor' }),
      );
      expect(service.updateSession).toHaveBeenCalled();
    });

    it('tutor cannot update another tutor session', async () => {
      await expect(
        controller.updateSession(
          reqAs(tutor),
          session({ tutor_id: 'other@example.com' }),
        ),
      ).rejects.toThrow('Unauthorized');
    });

    it('a user with no cognito groups is rejected, not crashed', async () => {
      const groupless: User = {
        username: 'nogroups',
        email: 'nogroups@example.com',
        groups: undefined as unknown as string[],
        contact: 'c-nogroups',
      };
      await expect(
        controller.getSessions(reqAs(groupless), '', '', '', '', ''),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.updateSession(reqAs(groupless), session()),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.createSession(reqAs(groupless), session()),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.createSessions(reqAs(groupless), [session()]),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.deleteSession(reqAs(groupless), 's-1'),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin deletes a session', async () => {
      await controller.deleteSession(reqAs(admin), 's-1');
      expect(service.deleteSession).toHaveBeenCalledWith('s-1');
    });

    it('non-admin cannot delete a session', async () => {
      await expect(
        controller.deleteSession(reqAs(tutor), 's-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
