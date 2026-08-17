import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { TeamsService } from '../teams/teams.service';
import { User } from '../models/user.model';
import { Session, SessionType } from '../models/session.model';
import { Team } from '../models/team.model';

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
const lead: User = {
  username: 'lead',
  email: 'lead@example.com',
  groups: ['LeadTutors'],
  contact: 'c-lead',
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
  let teamsService: jest.Mocked<TeamsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<SessionsService>> = {
      getSessions: jest.fn(),
      getSessionById: jest.fn(),
      getSessionsByTutor: jest.fn(),
      getSessionsByTutors: jest.fn(),
      getSessionsByStudent: jest.fn(),
      getAllSessions: jest.fn(),
      getSessionsBySeries: jest.fn(),
      createSession: jest.fn(),
      createSessions: jest.fn(),
      updateSession: jest.fn(),
      deleteSession: jest.fn(),
    };
    const teamsServiceMock: Partial<jest.Mocked<TeamsService>> = {
      getTeamByLead: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: serviceMock },
        { provide: TeamsService, useValue: teamsServiceMock },
      ],
    }).compile();
    controller = module.get(SessionsController);
    service = module.get(SessionsService);
    teamsService = module.get(TeamsService);
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
      await controller.getSessions(reqAs(admin), 'c-tutor', '', '', '', '');
      expect(service.getSessionsByTutor).toHaveBeenCalledWith(
        'c-tutor',
        undefined,
      );
    });

    it('owning tutor + tutor only -> getSessionsByTutor', async () => {
      await controller.getSessions(reqAs(tutor), 'c-tutor', '', '', '', '');
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

    it('plain tutor + no params -> still unauthorized (team read is lead-only)', async () => {
      await expect(
        controller.getSessions(reqAs(tutor), '', '', '', '', ''),
      ).rejects.toThrow('Unauthorized');
      expect(teamsService.getTeamByLead).not.toHaveBeenCalled();
    });
  });

  describe('lead tutor team visibility', () => {
    const teamOf = (members: string[]): Team =>
      ({
        id: 'team-1',
        name: 'Team A',
        lead_contact_id: 'c-lead',
        member_contact_ids: members,
      }) as Team;

    it('lead + no params -> team sessions in one call, lead included', async () => {
      teamsService.getTeamByLead.mockResolvedValue(teamOf(['c-m1', 'c-m2']));
      await controller.getSessions(
        reqAs(lead),
        '',
        '',
        '',
        '2026-01-01',
        '2026-02-01',
      );
      expect(teamsService.getTeamByLead).toHaveBeenCalledWith('c-lead');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead', 'c-m1', 'c-m2'],
        { from: '2026-01-01', to: '2026-02-01' },
      );
    });

    it('dedupes a lead mistakenly listed among the members', async () => {
      teamsService.getTeamByLead.mockResolvedValue(teamOf(['c-lead', 'c-m1']));
      await controller.getSessions(reqAs(lead), '', '', '', '', '');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead', 'c-m1'],
        undefined,
      );
    });

    it('tolerates a team with no member list', async () => {
      teamsService.getTeamByLead.mockResolvedValue({
        id: 'team-1',
        name: 'Team A',
        lead_contact_id: 'c-lead',
      } as Team);
      await controller.getSessions(reqAs(lead), '', '', '', '', '');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead'],
        undefined,
      );
    });

    it('lead with no team degrades to their own sessions', async () => {
      teamsService.getTeamByLead.mockResolvedValue(undefined);
      await controller.getSessions(reqAs(lead), '', '', '', '2026-01-01', '');
      expect(service.getSessionsByTutor).toHaveBeenCalledWith('c-lead', {
        from: '2026-01-01',
        to: undefined,
      });
      expect(service.getSessionsByTutors).not.toHaveBeenCalled();
    });

    it('lead may fetch their own sessions via ?tutor=self', async () => {
      await controller.getSessions(reqAs(lead), 'c-lead', '', '', '', '');
      expect(service.getSessionsByTutor).toHaveBeenCalledWith(
        'c-lead',
        undefined,
      );
    });

    it('lead may fetch own tutor+student sessions', async () => {
      await controller.getSessions(reqAs(lead), 'c-lead', 'stu-1', '', '', '');
      expect(service.getSessions).toHaveBeenCalledWith(
        'c-lead',
        'stu-1',
        undefined,
      );
    });

    it('lead cannot fetch a member by ?tutor= directly', async () => {
      await expect(
        controller.getSessions(reqAs(lead), 'c-m1', '', '', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('lead cannot fetch by student or series', async () => {
      await expect(
        controller.getSessions(reqAs(lead), '', 'stu-1', '', '', ''),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.getSessions(reqAs(lead), '', '', 'series-1', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('lead updates their OWN stored session like any tutor', async () => {
      service.getSessionById.mockResolvedValue(session({ tutor_id: 'c-lead' }));
      await controller.updateSession(
        reqAs(lead),
        session({ tutor_id: 'c-lead' }),
      );
      expect(service.updateSession).toHaveBeenCalled();
    });

    it('lead cannot update a member session (read-only visibility)', async () => {
      await expect(
        controller.updateSession(reqAs(lead), session({ tutor_id: 'c-m1' })),
      ).rejects.toThrow('Unauthorized');
    });

    it('lead cannot hijack a member session by claiming their own id', async () => {
      service.getSessionById.mockResolvedValue(session({ tutor_id: 'c-m1' }));
      await expect(
        controller.updateSession(reqAs(lead), session({ tutor_id: 'c-lead' })),
      ).rejects.toThrow('Unauthorized');
      expect(service.updateSession).not.toHaveBeenCalled();
    });

    it('lead cannot create or delete sessions', async () => {
      await expect(
        controller.createSession(reqAs(lead), session()),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.createSessions(reqAs(lead), [session()]),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.deleteSession(reqAs(lead), 's-1'),
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

    it('admin updates any session without an ownership lookup', async () => {
      await controller.updateSession(
        reqAs(admin),
        session({ tutor_id: 'other@example.com' }),
      );
      expect(service.updateSession).toHaveBeenCalled();
      expect(service.getSessionById).not.toHaveBeenCalled();
    });

    it('owning tutor updates their own stored session', async () => {
      service.getSessionById.mockResolvedValue(
        session({ tutor_id: 'c-tutor' }),
      );
      await controller.updateSession(
        reqAs(tutor),
        session({ tutor_id: 'c-tutor' }),
      );
      expect(service.getSessionById).toHaveBeenCalledWith('s-1');
      expect(service.updateSession).toHaveBeenCalled();
    });

    it('tutor cannot update another tutor session (payload claims the other tutor)', async () => {
      await expect(
        controller.updateSession(
          reqAs(tutor),
          session({ tutor_id: 'other@example.com' }),
        ),
      ).rejects.toThrow('Unauthorized');
      // Fails on the payload check — no lookup needed.
      expect(service.getSessionById).not.toHaveBeenCalled();
    });

    it('tutor cannot hijack a session stored under another tutor by claiming their own id', async () => {
      // The stored record is the authority: payload says c-tutor, storage says otherwise.
      service.getSessionById.mockResolvedValue(
        session({ tutor_id: 'c-other-tutor' }),
      );
      await expect(
        controller.updateSession(
          reqAs(tutor),
          session({ tutor_id: 'c-tutor' }),
        ),
      ).rejects.toThrow('Unauthorized');
      expect(service.getSessionById).toHaveBeenCalledWith('s-1');
      expect(service.updateSession).not.toHaveBeenCalled();
    });

    it('tutor cannot update a session that does not exist', async () => {
      service.getSessionById.mockResolvedValue(undefined);
      await expect(
        controller.updateSession(
          reqAs(tutor),
          session({ tutor_id: 'c-tutor' }),
        ),
      ).rejects.toThrow('Unauthorized');
      expect(service.updateSession).not.toHaveBeenCalled();
    });

    it('tutor cannot update a payload with no session id', async () => {
      await expect(
        controller.updateSession(
          reqAs(tutor),
          session({ id: undefined, tutor_id: 'c-tutor' }),
        ),
      ).rejects.toThrow('Unauthorized');
      expect(service.getSessionById).not.toHaveBeenCalled();
      expect(service.updateSession).not.toHaveBeenCalled();
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
