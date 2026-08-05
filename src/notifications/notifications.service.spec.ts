import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { SessionsService } from '../sessions/sessions.service';
import { ContactsService } from '../contacts/contacts.service';
import { Session, SessionType } from '../models/session.model';

const sesMock = mockClient(SESClient);

const PAST = '2020-01-01T10:00:00Z';
const PAST_END = '2020-01-01T11:00:00Z';
const FUTURE = '2999-01-01T10:00:00Z';

const stale = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 's-1',
    type: SessionType.TUTORING,
    status: 'Pending',
    start_datetime: PAST,
    end_datetime: PAST_END,
    notes: '',
    tutor_id: 'tutor-1',
    tutor_name: 'Tess',
    student_name: 'Pat',
    ...overrides,
  }) as Session;

describe('NotificationsService', () => {
  let service: NotificationsService;
  let sessionsService: jest.Mocked<SessionsService>;
  let contactsService: jest.Mocked<ContactsService>;

  beforeEach(async () => {
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({});
    process.env.SES_FROM_EMAIL = 'noreply@example.com';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: SessionsService, useValue: { getAllSessions: jest.fn() } },
        { provide: ContactsService, useValue: { getContact: jest.fn() } },
      ],
    }).compile();
    service = module.get(NotificationsService);
    sessionsService = module.get(SessionsService);
    contactsService = module.get(ContactsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns early and sends nothing when fetching sessions fails', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    sessionsService.getAllSessions.mockRejectedValue(new Error('db down'));
    await service.sendPendingSessionReminders();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to fetch sessions for reminder job',
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('announces the job start with the exact log line', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    sessionsService.getAllSessions.mockResolvedValue([] as never);
    await service.sendPendingSessionReminders();
    expect(logSpy).toHaveBeenCalledWith('Running pending session reminder job...');
    logSpy.mockRestore();
  });

  it('cuts the stale window at local midnight, not the current hour', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // 18:00 UTC / 14:00 ET — mid-afternoon in both CI (UTC) and local (ET).
    jest.setSystemTime(new Date('2026-08-05T18:00:00Z'));
    try {
    contactsService.getContact.mockResolvedValue([
      { id: 'tutor-1', first_name: 'Tess', email: 'tess@example.com' },
    ] as never);
      sessionsService.getAllSessions.mockResolvedValue([
        // Ended earlier TODAY (after midnight in both timezones): not stale.
        stale({
          start_datetime: '2026-08-05T11:00:00Z',
          end_datetime: '2026-08-05T12:00:00Z',
        }),
      ] as never);
      await service.sendPendingSessionReminders();
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves the SES region from the environment with a us-east-1 fallback', async () => {
    const originalRegion = process.env.AWS_DEFAULT_REGION;
    try {
      process.env.AWS_DEFAULT_REGION = 'eu-test-1';
      const configured = new NotificationsService(
        sessionsService as never,
        contactsService as never,
      );
      const configuredRegion = (configured as unknown as {
        ses: { config: { region: () => Promise<string> } };
      }).ses.config.region;
      await expect(configuredRegion()).resolves.toBe('eu-test-1');

      delete process.env.AWS_DEFAULT_REGION;
      const fallback = new NotificationsService(
        sessionsService as never,
        contactsService as never,
      );
      const fallbackRegion = (fallback as unknown as {
        ses: { config: { region: () => Promise<string> } };
      }).ses.config.region;
      await expect(fallbackRegion()).resolves.toBe('us-east-1');
    } finally {
      if (originalRegion === undefined) {
        delete process.env.AWS_DEFAULT_REGION;
      } else {
        process.env.AWS_DEFAULT_REGION = originalRegion;
      }
    }
  });

  it('includes stale pending TRIAL sessions in the digest', async () => {
    sessionsService.getAllSessions.mockResolvedValue([
      stale({ type: SessionType.TRIAL }),
    ] as never);
    contactsService.getContact.mockResolvedValue([
      { id: 'tutor-1', first_name: 'Tess', email: 'tess@example.com' },
    ] as never);
    await service.sendPendingSessionReminders();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  it('sends nothing when there are no stale pending sessions', async () => {
    // Contact resolvable — a wrongly-included session would actually send.
    contactsService.getContact.mockResolvedValue([
      { id: 'tutor-1', first_name: 'Tess', email: 'tess@example.com' },
    ] as never);
    sessionsService.getAllSessions.mockResolvedValue([
      stale({ status: 'Completed' }),
      stale({ end_datetime: FUTURE, start_datetime: FUTURE }),
      stale({ type: SessionType.ADMIN }),
      stale({ end_datetime: undefined }),
    ] as never);
    await service.sendPendingSessionReminders();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('sends one digest email per tutor with the right subject', async () => {
    sessionsService.getAllSessions.mockResolvedValue([
      stale({ id: 'a', start_datetime: '2020-01-02T10:00:00Z' }),
      stale({ id: 'b', start_datetime: '2020-01-01T10:00:00Z' }),
    ] as never);
    contactsService.getContact.mockResolvedValue([
      { email: 'tutor@example.com', first_name: 'Tess', last_name: 'Coach' },
    ] as never);

    await service.sendPendingSessionReminders();

    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Destination?.ToAddresses).toEqual(['tutor@example.com']);
    expect(input.Message?.Subject?.Data).toBe(
      'Action Required: 2 sessions are awaiting attendance',
    );
    expect(input.Source).toBe('noreply@example.com');
  });

  it('uses singular wording for a single stale session and tolerates a nameless contact', async () => {
    sessionsService.getAllSessions.mockResolvedValue([
      stale({ student_name: undefined }),
    ] as never);
    // No first_name/last_name exercises the `?? ''` name fallbacks.
    contactsService.getContact.mockResolvedValue([
      { email: 'tutor@example.com' },
    ] as never);

    await service.sendPendingSessionReminders();

    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message?.Subject?.Data).toBe(
      'Action Required: 1 session is awaiting attendance',
    );
  });

  it('skips sessions without a tutor_id', async () => {
    sessionsService.getAllSessions.mockResolvedValue([
      stale({ id: 'no-tutor', tutor_id: undefined as never }),
    ] as never);
    await service.sendPendingSessionReminders();
    expect(contactsService.getContact).not.toHaveBeenCalled();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('skips a tutor whose contact has no email', async () => {
    sessionsService.getAllSessions.mockResolvedValue([stale()] as never);
    contactsService.getContact.mockResolvedValue([
      { first_name: 'NoEmail' },
    ] as never);
    await service.sendPendingSessionReminders();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('continues when sending for one tutor throws', async () => {
    sessionsService.getAllSessions.mockResolvedValue([stale()] as never);
    contactsService.getContact.mockRejectedValue(new Error('lookup failed'));
    await expect(
      service.sendPendingSessionReminders(),
    ).resolves.toBeUndefined();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('does not send when SES_FROM_EMAIL is unset', async () => {
    delete process.env.SES_FROM_EMAIL;
    sessionsService.getAllSessions.mockResolvedValue([stale()] as never);
    contactsService.getContact.mockResolvedValue([
      { email: 'tutor@example.com', first_name: 'Tess', last_name: 'Coach' },
    ] as never);
    await service.sendPendingSessionReminders();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});
