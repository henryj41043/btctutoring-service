import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from './sessions.service';
import { SessionsModel } from '../models/sessions.model';
import { Session, SessionType } from '../models/session.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/sessions.model', () => ({
  SessionsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = SessionsModel as unknown as ModelMock;

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

    it('getSessionsByTutor scans by tutor', async () => {
      scanResolves(Model, []);
      await service.getSessionsByTutor('tutor@example.com');
      expect(Model.scan).toHaveBeenCalledWith({
        tutor_id: { eq: 'tutor@example.com' },
      });
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
      ['getSessionsByStudent', () => service.getSessionsByStudent('s')],
      ['getAllSessions', () => service.getAllSessions()],
      ['getSessionsBySeries', () => service.getSessionsBySeries('x')],
    ])('%s rejects when the scan fails', async (_name, call) => {
      scanRejects(Model, new Error('scan boom'));
      await expect(call()).rejects.toThrow('scan boom');
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
});
