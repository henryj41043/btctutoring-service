import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { TeamsService } from '../teams/teams.service';
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
      setAttendance: jest.fn(),
      emailSessionNotes: jest.fn(),
      getSessionsByTutor: jest.fn(),
      getSessionsByTutors: jest.fn(),
      getSessionsByStudent: jest.fn(),
      getAllSessions: jest.fn(),
      getSessionsBySeries: jest.fn(),
      getScheduledMakeupMinutes: jest.fn(),
      createSession: jest.fn(),
      createSessions: jest.fn(),
      updateSession: jest.fn(),
      deleteSession: jest.fn(),
    };
    const teamsServiceMock: Partial<jest.Mocked<TeamsService>> = {
      resolveTeamTutorIds: jest.fn(),
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

  describe('getScheduledMakeup', () => {
    const totals = [{ student_id: 's-1', scheduled_minutes: 45 }];

    it('an admin gets every student', async () => {
      service.getScheduledMakeupMinutes.mockResolvedValue(totals);
      await expect(controller.getScheduledMakeup(reqAs(admin))).resolves.toBe(
        totals,
      );
      expect(service.getScheduledMakeupMinutes).toHaveBeenCalledWith();
    });

    it.each([
      ['tutor', () => tutor, 'c-tutor'],
      ['lead tutor', () => lead, 'c-lead'],
    ])('a %s gets their own students only', async (_who, user, contact) => {
      service.getScheduledMakeupMinutes.mockResolvedValue(totals);
      await expect(controller.getScheduledMakeup(reqAs(user()))).resolves.toBe(
        totals,
      );
      expect(service.getScheduledMakeupMinutes).toHaveBeenCalledWith(contact);
    });

    it('a tutor without a contact id is refused rather than given everything', async () => {
      await expect(
        controller.getScheduledMakeup(
          reqAs({ ...tutor, contact: '' as never }),
        ),
      ).rejects.toThrow('Unauthorized');
      expect(service.getScheduledMakeupMinutes).not.toHaveBeenCalled();
    });

    it('anyone else is refused', async () => {
      await expect(
        controller.getScheduledMakeup(reqAs(stranger)),
      ).rejects.toThrow('Unauthorized');
      expect(service.getScheduledMakeupMinutes).not.toHaveBeenCalled();
    });
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
      expect(teamsService.resolveTeamTutorIds).not.toHaveBeenCalled();
    });
  });

  describe('lead tutor team visibility', () => {
    it('lead + no params -> team sessions in one call, lead included', async () => {
      teamsService.resolveTeamTutorIds.mockResolvedValue(['c-m1', 'c-m2']);
      await controller.getSessions(
        reqAs(lead),
        '',
        '',
        '',
        '2026-01-01',
        '2026-02-01',
      );
      expect(teamsService.resolveTeamTutorIds).toHaveBeenCalledWith('c-lead');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead', 'c-m1', 'c-m2'],
        { from: '2026-01-01', to: '2026-02-01' },
      );
    });

    it('nested teams: the resolver may return another lead and their members', async () => {
      teamsService.resolveTeamTutorIds.mockResolvedValue([
        'c-emily',
        'c-m1',
        'c-m2',
      ]);
      await controller.getSessions(reqAs(lead), '', '', '', '', '');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead', 'c-emily', 'c-m1', 'c-m2'],
        undefined,
      );
    });

    it('dedupes a lead mistakenly returned among the members', async () => {
      teamsService.resolveTeamTutorIds.mockResolvedValue(['c-lead', 'c-m1']);
      await controller.getSessions(reqAs(lead), '', '', '', '', '');
      expect(service.getSessionsByTutors).toHaveBeenCalledWith(
        ['c-lead', 'c-m1'],
        undefined,
      );
    });

    it('lead with no team (or an empty one) degrades to their own sessions', async () => {
      teamsService.resolveTeamTutorIds.mockResolvedValue([]);
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

    it('non-admin cannot create a regular (non-make-up) session', async () => {
      await expect(
        controller.createSession(reqAs(tutor), session()),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin creates a custom trial', async () => {
      const custom = session({ type: SessionType.CUSTOM_TRIAL });
      await controller.createSession(reqAs(admin), custom);
      expect(service.createSession).toHaveBeenCalledWith(custom);
    });

    it.each([
      ['tutor', () => tutor, 'c-tutor'],
      ['lead tutor', () => lead, 'c-lead'],
    ])(
      'a %s cannot create a custom trial, even for themselves',
      async (_who, user, contact) => {
        await expect(
          controller.createSession(
            reqAs(user()),
            session({ type: SessionType.CUSTOM_TRIAL, tutor_id: contact }),
          ),
        ).rejects.toThrow('Unauthorized');
        expect(service.createSession).not.toHaveBeenCalled();
      },
    );

    it('tutor creates their OWN make-up session', async () => {
      await controller.createSession(
        reqAs(tutor),
        session({ type: SessionType.MAKE_UP, tutor_id: 'c-tutor' }),
      );
      expect(service.createSession).toHaveBeenCalled();
    });

    it('lead creates their OWN make-up session (tutor-like)', async () => {
      await controller.createSession(
        reqAs(lead),
        session({ type: SessionType.MAKE_UP, tutor_id: 'c-lead' }),
      );
      expect(service.createSession).toHaveBeenCalled();
    });

    it('tutor cannot create a make-up assigned to someone else', async () => {
      await expect(
        controller.createSession(
          reqAs(tutor),
          session({ type: SessionType.MAKE_UP, tutor_id: 'c-other' }),
        ),
      ).rejects.toThrow('Unauthorized');
      expect(service.createSession).not.toHaveBeenCalled();
    });

    it('tutor cannot create a make-up with no tutor on it', async () => {
      await expect(
        controller.createSession(
          reqAs(tutor),
          session({ type: SessionType.MAKE_UP, tutor_id: undefined }),
        ),
      ).rejects.toThrow('Unauthorized');
    });

    it('groupless user cannot create even a self-assigned make-up', async () => {
      await expect(
        controller.createSession(
          reqAs(stranger),
          session({ type: SessionType.MAKE_UP, tutor_id: 'c-stranger' }),
        ),
      ).rejects.toThrow('Unauthorized');
    });

    describe('session type', () => {
      const pending = (over: Partial<Session> = {}) =>
        session({ tutor_id: 'c-tutor', ...over });

      it.each([
        SessionType.ADMIN,
        SessionType.MAKE_UP,
        SessionType.TRIAL,
        SessionType.CUSTOM_TRIAL,
        SessionType.GROUP,
      ])(
        'a tutor cannot turn their own pending tutoring session into %s',
        async (type) => {
          service.getSessionById.mockResolvedValue(pending());
          await expect(
            controller.updateSession(reqAs(tutor), pending({ type })),
          ).rejects.toThrow('Only an admin can change the session type.');
          expect(service.updateSession).not.toHaveBeenCalled();
        },
      );

      it('a tutor cannot turn their own make-up into a tutoring session', async () => {
        service.getSessionById.mockResolvedValue(
          pending({ type: SessionType.MAKE_UP }),
        );
        await expect(
          controller.updateSession(
            reqAs(tutor),
            pending({ type: SessionType.TUTORING }),
          ),
        ).rejects.toThrow('Only an admin can change the session type.');
      });

      it('a lead tutor is held to the same rule', async () => {
        service.getSessionById.mockResolvedValue(
          pending({ tutor_id: 'c-lead' }),
        );
        await expect(
          controller.updateSession(
            reqAs(lead),
            pending({ tutor_id: 'c-lead', type: SessionType.ADMIN }),
          ),
        ).rejects.toThrow('Only an admin can change the session type.');
      });

      it('a tutor still updates a session whose type is unchanged or left out', async () => {
        service.getSessionById.mockResolvedValue(pending());
        await controller.updateSession(reqAs(tutor), pending({ notes: 'x' }));
        await controller.updateSession(
          reqAs(tutor),
          pending({ type: undefined, notes: 'y' }),
        );
        expect(service.updateSession).toHaveBeenCalledTimes(2);
      });

      it('a session stored without a type counts as tutoring', async () => {
        service.getSessionById.mockResolvedValue(pending({ type: undefined }));
        await controller.updateSession(
          reqAs(tutor),
          pending({ type: SessionType.TUTORING }),
        );
        expect(service.updateSession).toHaveBeenCalledTimes(1);
        await expect(
          controller.updateSession(
            reqAs(tutor),
            pending({ type: SessionType.ADMIN }),
          ),
        ).rejects.toThrow('Only an admin can change the session type.');
      });

      it('an admin may change the type', async () => {
        service.getSessionById.mockResolvedValue(pending());
        await controller.updateSession(
          reqAs(admin),
          pending({ type: SessionType.CUSTOM_TRIAL }),
        );
        expect(service.updateSession).toHaveBeenCalledWith(
          expect.objectContaining({ type: SessionType.CUSTOM_TRIAL }),
        );
      });
    });

    it('admin emails session notes without an ownership lookup', async () => {
      service.emailSessionNotes.mockResolvedValue({ id: 's-1' } as never);
      await controller.emailSessionNotes(reqAs(admin), 's-1');
      expect(service.emailSessionNotes).toHaveBeenCalledWith('s-1');
      expect(service.getSessionById).not.toHaveBeenCalled();
    });

    it('tutor emails notes for their OWN stored session', async () => {
      service.getSessionById.mockResolvedValue(
        session({ tutor_id: 'c-tutor' }),
      );
      service.emailSessionNotes.mockResolvedValue({ id: 's-1' } as never);
      await controller.emailSessionNotes(reqAs(tutor), 's-1');
      expect(service.emailSessionNotes).toHaveBeenCalledWith('s-1');
    });

    it("tutor cannot email notes for someone else's session", async () => {
      service.getSessionById.mockResolvedValue(
        session({ tutor_id: 'c-other' }),
      );
      await expect(
        controller.emailSessionNotes(reqAs(tutor), 's-1'),
      ).rejects.toThrow('Unauthorized');
      expect(service.emailSessionNotes).not.toHaveBeenCalled();
    });

    it('tutor cannot email notes for a missing session', async () => {
      service.getSessionById.mockResolvedValue(undefined);
      await expect(
        controller.emailSessionNotes(reqAs(tutor), 'nope'),
      ).rejects.toThrow('Unauthorized');
    });

    it('groupless user cannot email notes at all', async () => {
      await expect(
        controller.emailSessionNotes(reqAs(stranger), 's-1'),
      ).rejects.toThrow('Unauthorized');
      expect(service.getSessionById).not.toHaveBeenCalled();
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

    it('admin updates any session, whoever it belongs to', async () => {
      service.getSessionById.mockResolvedValue(
        session({ tutor_id: 'other@example.com' }),
      );
      await controller.updateSession(
        reqAs(admin),
        session({ tutor_id: 'other@example.com' }),
      );
      expect(service.updateSession).toHaveBeenCalled();
    });

    it('admin updates a session that is not stored yet, or has no id', async () => {
      service.getSessionById.mockResolvedValue(undefined);
      await controller.updateSession(reqAs(admin), session());
      await controller.updateSession(reqAs(admin), session({ id: undefined }));
      expect(service.updateSession).toHaveBeenCalledTimes(2);
      expect(service.getSessionById).toHaveBeenCalledTimes(1);
    });

    describe('attendance lock', () => {
      const final = (over: Partial<Session> = {}): Session =>
        session({ status: 'Completed', notes: 'old', ...over });
      const LOCKED = 'Attendance is final. Ask an admin to correct it.';

      it('a tutor may still edit the notes of a finalized session', async () => {
        service.getSessionById.mockResolvedValue(final());
        await controller.updateSession(
          reqAs(tutor),
          final({ notes: 'corrected a typo' }),
        );
        expect(service.updateSession).toHaveBeenCalledWith(
          final({ notes: 'corrected a typo' }),
        );
      });

      it('an equivalent timestamp is not a change', async () => {
        service.getSessionById.mockResolvedValue(final());
        await controller.updateSession(
          reqAs(tutor),
          final({
            start_datetime: '2026-01-01T10:00:00.000Z',
            end_datetime: '2026-01-01T11:00:00.000Z',
          }),
        );
        expect(service.updateSession).toHaveBeenCalled();
      });

      it.each([
        ['status', { status: 'Cancelled' }],
        ['status back to Pending', { status: 'Pending' }],
        ['type', { type: SessionType.MAKE_UP }],
        ['start time', { start_datetime: '2026-01-01T09:00:00Z' }],
        ['end time', { end_datetime: '2026-01-01T12:00:00Z' }],
        ['student', { student_id: 'student-2' }],
        ['roster', { participants: [{ id: 'p-1', name: 'Pat' }] }],
      ])(
        'a tutor cannot change the %s of a finalized session',
        async (_n, over) => {
          service.getSessionById.mockResolvedValue(final());
          await expect(
            controller.updateSession(reqAs(tutor), final(over)),
          ).rejects.toThrow(LOCKED);
          expect(service.updateSession).not.toHaveBeenCalled();
        },
      );

      it('a lead is locked on their own finalized session like any tutor', async () => {
        service.getSessionById.mockResolvedValue(final({ tutor_id: 'c-lead' }));
        await expect(
          controller.updateSession(
            reqAs(lead),
            final({ tutor_id: 'c-lead', status: 'Cancelled' }),
          ),
        ).rejects.toThrow(LOCKED);
      });

      it('an admin may change everything but the status', async () => {
        service.getSessionById.mockResolvedValue(final());
        await controller.updateSession(
          reqAs(admin),
          final({
            type: SessionType.MAKE_UP,
            start_datetime: '2026-01-01T09:00:00Z',
            student_id: 'student-2',
            tutor_id: 'c-other',
          }),
        );
        expect(service.updateSession).toHaveBeenCalled();
      });

      it('nobody changes a finalized status through the ordinary update', async () => {
        service.getSessionById.mockResolvedValue(final());
        await expect(
          controller.updateSession(
            reqAs(admin),
            final({ status: 'Cancelled' }),
          ),
        ).rejects.toThrow(
          'Attendance was already taken: change it with PUT /sessions/:id/attendance.',
        );
        expect(service.updateSession).not.toHaveBeenCalled();
      });

      it.each([
        ['a tutor', () => tutor, 'Completed'],
        ['a tutor', () => tutor, 'Cancelled'],
        ['a tutor', () => tutor, 'NCNS'],
        ['an admin', () => admin, 'Completed'],
        ['an admin', () => admin, 'Cancelled'],
      ])(
        '%s cannot take attendance through the ordinary update (%s)',
        async (_who, user, status) => {
          service.getSessionById.mockResolvedValue(session());
          await expect(
            controller.updateSession(reqAs(user()), session({ status })),
          ).rejects.toThrow(
            'Take attendance with PUT /sessions/:id/attendance.',
          );
          expect(service.updateSession).not.toHaveBeenCalled();
        },
      );

      it('a session stored without a status counts as pending', async () => {
        service.getSessionById.mockResolvedValue(
          session({ status: undefined }),
        );
        await expect(
          controller.updateSession(
            reqAs(admin),
            session({ status: 'Completed' }),
          ),
        ).rejects.toThrow('Take attendance with PUT /sessions/:id/attendance.');
      });

      it('a pending session is still edited freely while it stays pending', async () => {
        service.getSessionById.mockResolvedValue(session());
        await controller.updateSession(
          reqAs(tutor),
          session({ start_datetime: '2026-01-01T09:00:00Z' }),
        );
        await controller.updateSession(
          reqAs(tutor),
          session({ status: undefined, notes: 'moved' }),
        );
        expect(service.updateSession).toHaveBeenCalledTimes(2);
      });
    });

    describe('setAttendance', () => {
      it('hands the request, the caller and the dry-run flag to the service', async () => {
        const result = { dry_run: false } as never;
        service.setAttendance.mockResolvedValue(result);
        const body = { status: 'Completed', notes: 'n' };
        expect(await controller.setAttendance(reqAs(tutor), 's-1', body)).toBe(
          result,
        );
        expect(service.setAttendance).toHaveBeenCalledWith('s-1', body, tutor, {
          dryRun: false,
        });
        await controller.setAttendance(reqAs(admin), 's-1', body, 'true');
        expect(service.setAttendance).toHaveBeenLastCalledWith(
          's-1',
          body,
          admin,
          { dryRun: true },
        );
        await controller.setAttendance(reqAs(admin), 's-1', body, 'yes');
        expect(service.setAttendance).toHaveBeenLastCalledWith(
          's-1',
          body,
          admin,
          { dryRun: false },
        );
      });
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
