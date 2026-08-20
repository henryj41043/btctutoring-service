import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsModel } from '../models/sessions.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Session, SessionType } from '../models/session.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/sessions.model', () => ({
  SessionsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('../models/students.model', () => ({
  StudentsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('../models/contacts.model', () => ({
  ContactsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = SessionsModel as unknown as ModelMock;
const Students = StudentsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;
const sesMock = mockClient(SESClient);

const sampleSession = (overrides: Partial<Session> = {}): Session =>
  ({
    id: 'session-1',
    type: SessionType.TUTORING,
    end_datetime: '2026-01-01T11:00:00Z',
    notes: '',
    start_datetime: '2026-01-01T10:00:00Z',
    status: 'Pending',
    student_id: 'student-1',
    student_name: 'Pat',
    tutor_id: 'tutor@example.com',
    tutor_name: 'Tess',
    series_id: 'series-1',
    ...overrides,
  }) as Session;

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionsService],
    }).compile();
    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('read queries', () => {
    it('getSessions scans by tutor and student', async () => {
      const sessions = [sampleSession()];
      scanResolves(Model, sessions);
      await expect(
        service.getSessions('tutor@example.com', 'student-1'),
      ).resolves.toBe(sessions);
      expect(Model.scan).toHaveBeenCalledWith({
        tutor_id: { eq: 'tutor@example.com' },
        student_id: { eq: 'student-1' },
      });
    });

    it('getSessionById does a keyed get', async () => {
      Model.get.mockResolvedValue({ id: 's-1' });
      await expect(service.getSessionById('s-1')).resolves.toEqual({
        id: 's-1',
      });
      expect(Model.get).toHaveBeenCalledWith('s-1');
    });

    it('getSessionById returns undefined for an unknown id', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.getSessionById('nope')).resolves.toBeUndefined();
    });

    it('getSessionById rejects when the get fails', async () => {
      Model.get.mockRejectedValue(new Error('get boom'));
      await expect(service.getSessionById('s-1')).rejects.toThrow('get boom');
    });

    it('getSessionsByTutor scans by tutor', async () => {
      scanResolves(Model, []);
      await service.getSessionsByTutor('tutor@example.com');
      expect(Model.scan).toHaveBeenCalledWith({
        tutor_id: { eq: 'tutor@example.com' },
      });
    });

    it('getSessionsByTutors scans once with the exact id set', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessionsByTutors(['c-lead', 'c-m1', 'c-m2']);
      expect(Model.scan).toHaveBeenCalledWith();
      expect(chain.where).toHaveBeenCalledWith('tutor_id');
      expect(chain.in).toHaveBeenCalledWith(['c-lead', 'c-m1', 'c-m2']);
      expect(chain.all).toHaveBeenCalled();
    });

    it('getSessionsByTutors applies the start_datetime range', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessionsByTutors(['c-lead'], {
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      expect(chain.where).toHaveBeenCalledWith('start_datetime');
      expect(chain.between).toHaveBeenCalledWith(
        '2026-07-01T00:00:00Z',
        '2026-07-31T23:59:59Z',
      );
    });

    it('getSessionsByStudent scans by student', async () => {
      scanResolves(Model, []);
      await service.getSessionsByStudent('student-1');
      expect(Model.scan).toHaveBeenCalledWith({
        student_id: { eq: 'student-1' },
      });
    });

    it('getAllSessions scans everything', async () => {
      scanResolves(Model, []);
      await service.getAllSessions();
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it('getSessionsBySeries scans by series', async () => {
      scanResolves(Model, []);
      await service.getSessionsBySeries('series-1');
      expect(Model.scan).toHaveBeenCalledWith({
        series_id: { eq: 'series-1' },
      });
    });

    it.each([
      ['getSessions', () => service.getSessions('t', 's')],
      ['getSessionsByTutor', () => service.getSessionsByTutor('t')],
      ['getSessionsByTutors', () => service.getSessionsByTutors(['t'])],
      ['getSessionsByStudent', () => service.getSessionsByStudent('s')],
      ['getAllSessions', () => service.getAllSessions()],
      ['getSessionsBySeries', () => service.getSessionsBySeries('x')],
    ])('%s rejects when the scan fails', async (_name, call) => {
      scanRejects(Model, new Error('scan boom'));
      await expect(call()).rejects.toThrow('scan boom');
    });
  });

  describe('start_datetime range filtering', () => {
    it('applies between when both bounds are given', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessionsByTutor('tutor@example.com', {
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      });
      expect(chain.where).toHaveBeenCalledWith('start_datetime');
      expect(chain.between).toHaveBeenCalledWith(
        '2026-07-01T00:00:00Z',
        '2026-07-31T23:59:59Z',
      );
      expect(chain.all).toHaveBeenCalled();
    });

    it('applies ge for a from-only range', async () => {
      const chain = scanResolves(Model, []);
      await service.getAllSessions({ from: '2026-07-01T00:00:00Z' });
      expect(chain.where).toHaveBeenCalledWith('start_datetime');
      expect(chain.ge).toHaveBeenCalledWith('2026-07-01T00:00:00Z');
      expect(chain.between).not.toHaveBeenCalled();
    });

    it('applies le for a to-only range', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessionsByStudent('student-1', {
        to: '2026-07-31T23:59:59Z',
      });
      expect(chain.le).toHaveBeenCalledWith('2026-07-31T23:59:59Z');
      expect(chain.ge).not.toHaveBeenCalled();
    });

    it('applies no condition without a range and still paginates fully', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessions('tutor@example.com', 'student-1');
      expect(chain.where).not.toHaveBeenCalled();
      expect(chain.all).toHaveBeenCalled();
    });

    it('combines equality filters with the range', async () => {
      const chain = scanResolves(Model, []);
      await service.getSessions('tutor@example.com', 'student-1', {
        from: 'A',
        to: 'B',
      });
      expect(Model.scan).toHaveBeenCalledWith({
        tutor_id: { eq: 'tutor@example.com' },
        student_id: { eq: 'student-1' },
      });
      expect(chain.between).toHaveBeenCalledWith('A', 'B');
    });
  });

  describe('createSession', () => {
    it('saves a session and returns a generated id', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createSession(sampleSession());
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Session created successfully.',
      });
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createSession(sampleSession())).rejects.toThrow(
        'save boom',
      );
    });
  });

  describe('createSessions (batch)', () => {
    it('chunks into batches of 25 and reports the count', async () => {
      Model.batchPut.mockResolvedValue(undefined);
      const sessions = Array.from({ length: 26 }, (_, i) =>
        sampleSession({ id: `s-${i}` }),
      );

      const result = await service.createSessions(sessions);

      // 26 items -> two batchPut calls (25 + 1)
      expect(Model.batchPut).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        ids: expect.any(Array),
        count: 26,
        message: 'Sessions created successfully.',
      });
      expect((result as { ids: string[] }).ids).toHaveLength(26);
    });

    it('rejects when a batch write fails', async () => {
      Model.batchPut.mockRejectedValue(new Error('batch boom'));
      await expect(service.createSessions([sampleSession()])).rejects.toThrow(
        'batch boom',
      );
    });
  });

  describe('updateSession', () => {
    it('updates and returns the session', async () => {
      const updated = sampleSession({ status: 'Completed' });
      Model.update.mockResolvedValue(updated);
      const result = await service.updateSession(sampleSession());
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: 'Pending' }),
      );
      expect(result).toBe(updated);
    });

    it('rejects when update fails', async () => {
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateSession(sampleSession())).rejects.toThrow(
        'update boom',
      );
    });
  });

  describe('deleteSession', () => {
    it('deletes the session and returns a confirmation', async () => {
      Model.delete.mockResolvedValue(undefined);
      await expect(service.deleteSession('session-1')).resolves.toEqual({
        id: 'session-1',
        message: 'Session deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'session-1' });
    });

    it('rejects when delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteSession('session-1')).rejects.toThrow(
        'delete boom',
      );
    });
  });

  describe('emailSessionNotes', () => {
    const completed = (overrides: Partial<Session> = {}): Session =>
      sampleSession({
        status: 'Completed',
        notes: 'Great progress on fractions today.',
        ...overrides,
      });

    beforeEach(() => {
      sesMock.reset();
      sesMock.on(SendEmailCommand).resolves({});
      process.env.SES_FROM_EMAIL = 'noreply@example.com';
      Model.get.mockResolvedValue(completed());
      Model.update.mockResolvedValue({});
      Students.get.mockResolvedValue({
        id: 'student-1',
        name: 'Pat',
        contact_id: 'c-1',
      });
      Contacts.get.mockResolvedValue({
        id: 'c-1',
        first_name: 'Jane',
        email: 'jane@example.com',
      });
    });

    afterEach(() => {
      delete process.env.SES_FROM_EMAIL;
    });

    it('emails the stored notes to the family and stamps notes_emailed_at', async () => {
      const result = await service.emailSessionNotes('session-1');
      expect(result.message).toBe('Session notes emailed.');
      expect(result.notes_emailed_at).toEqual(expect.any(String));

      const send = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(send.Source).toBe('noreply@example.com');
      expect(send.Destination?.ToAddresses).toEqual(['jane@example.com']);
      expect(send.Message?.Subject?.Data).toBe(
        'Session notes for Pat — January 1, 2026',
      );
      expect(send.Message?.Body?.Text?.Data).toContain('Hi Jane,');
      expect(send.Message?.Body?.Text?.Data).toContain(
        'Great progress on fractions today.',
      );
      expect(send.Message?.Body?.Text?.Data).toContain('with Tess');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { notes_emailed_at: expect.any(String) },
      );
    });

    it('falls back to the student record name and a tutor-less line', async () => {
      Model.get.mockResolvedValue(
        completed({ student_name: undefined, tutor_name: undefined }),
      );
      await service.emailSessionNotes('session-1');
      const send = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(send.Message?.Subject?.Data).toContain('Session notes for Pat');
      expect(send.Message?.Body?.Text?.Data).not.toContain('with ');
    });

    it('greets "there" when the contact has no first name', async () => {
      Contacts.get.mockResolvedValue({ id: 'c-1', email: 'jane@example.com' });
      await service.emailSessionNotes('session-1');
      const send = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      expect(send.Message?.Body?.Text?.Data).toContain('Hi there,');
    });

    it('fails closed when SES_FROM_EMAIL is unset (before any lookup)', async () => {
      delete process.env.SES_FROM_EMAIL;
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'Email sending is not configured',
      );
      expect(Model.get).not.toHaveBeenCalled();
    });

    it('404s on a missing session', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.emailSessionNotes('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([
      ['whitespace-only', '   '],
      ['absent', undefined],
    ])('refuses a session with %s notes', async (_label, notes) => {
      Model.get.mockResolvedValue(completed({ notes: notes as never }));
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it('refuses a session with no student', async () => {
      Model.get.mockResolvedValue(completed({ student_id: undefined }));
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'This session has no student.',
      );
    });

    it('404s when the student has no family contact', async () => {
      Students.get.mockResolvedValue({ id: 'student-1', name: 'Pat' });
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'No family contact for this student.',
      );
    });

    it('404s when the family contact has no email', async () => {
      Contacts.get.mockResolvedValue({ id: 'c-1', first_name: 'Jane' });
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'The family contact has no email address.',
      );
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it('propagates an SES failure without stamping', async () => {
      sesMock.on(SendEmailCommand).rejects(new Error('ses down'));
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'ses down',
      );
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('a failed stamp write never fails the request (email already sent)', async () => {
      Model.update.mockRejectedValue(new Error('ddb write throttled'));
      const result = await service.emailSessionNotes('session-1');
      expect(result.message).toBe('Session notes emailed.');
    });

    it.each([
      [
        'student lookup',
        () => Students.get.mockRejectedValue(new Error('boom')),
      ],
      [
        'contact lookup',
        () => Contacts.get.mockRejectedValue(new Error('boom')),
      ],
    ])('propagates a %s failure', async (_label, arm) => {
      arm();
      await expect(service.emailSessionNotes('session-1')).rejects.toThrow(
        'boom',
      );
    });
  });
});
