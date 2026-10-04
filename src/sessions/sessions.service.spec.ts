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

  describe('createMakeupSet', () => {
    const NOW = new Date('2026-10-05T12:00:00.000Z');
    const adminUser = {
      username: 'admin',
      email: 'a@x',
      groups: ['Admins'],
      contact: 'c-admin',
    };
    const tutorUser = {
      username: 't',
      email: 't@x',
      groups: ['Tutors'],
      contact: 't-1',
    };
    const leadUser = { ...tutorUser, groups: ['LeadTutors'] };
    const slot = (offset: number, minutes = 15) => {
      const start = new Date(Date.UTC(2026, 9, 5 + offset, 14, 0, 0));
      return {
        start_datetime: start.toISOString(),
        end_datetime: new Date(start.getTime() + minutes * 60000).toISOString(),
      };
    };
    const request = (over: object = {}) => ({
      student_id: 'student-1',
      tutor_id: 't-1',
      tutor_name: 'Tess',
      notes: 'Extra time',
      sessions: [slot(1), slot(8), slot(15)],
      ...over,
    });
    const activeStudent = (over: object = {}) => ({
      id: 'student-1',
      name: 'Pat',
      status: 'Active Student',
      assigned_tutor_id: 't-1',
      make_up_minutes: 30,
      make_up_batches: [
        { minutes: 30, earned_date: '2026-10-04T12:00:00.000Z' },
      ],
      ...over,
    });

    beforeEach(() => {
      jest.clearAllMocks();
      Students.get.mockResolvedValue(activeStudent());
      scanResolves(Model, []);
      Model.batchPut.mockResolvedValue(undefined);
    });

    it('creates the make-ups the minutes cover, under one series, and reports the rest', async () => {
      const result = await service.createMakeupSet(request(), tutorUser, {
        now: NOW,
      });
      expect(result).toMatchObject({
        dry_run: false,
        accepted: [0, 1],
        skipped: [{ index: 2, reason: 'insufficient' }],
        minutes_used: 30,
        minutes_left: 0,
        created: 2,
      });
      expect(result.ids).toHaveLength(2);
      expect(result.series_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(Students.get).toHaveBeenCalledWith('student-1');
      expect(Model.scan).toHaveBeenCalledWith({
        student_id: { eq: 'student-1' },
        type: { eq: 'MAKE_UP' },
        status: { eq: 'Pending' },
      });
      const written = Model.batchPut.mock.calls[0][0];
      expect(written).toHaveLength(2);
      expect(written[0]).toMatchObject({
        type: 'MAKE_UP',
        status: 'Pending',
        start_datetime: slot(1).start_datetime,
        end_datetime: slot(1).end_datetime,
        student_id: 'student-1',
        student_name: 'Pat',
        tutor_id: 't-1',
        tutor_name: 'Tess',
        notes: 'Extra time',
        series_id: result.series_id,
      });
      expect(written[1].series_id).toBe(result.series_id);
      expect(written[1].start_datetime).toBe(slot(8).start_datetime);
    });

    it('a dry run plans and writes nothing', async () => {
      const result = await service.createMakeupSet(request(), tutorUser, {
        dryRun: true,
        now: NOW,
      });
      expect(result).toEqual({
        accepted: [0, 1],
        skipped: [{ index: 2, reason: 'insufficient' }],
        minutes_used: 30,
        minutes_left: 0,
        dry_run: true,
        created: 0,
        ids: [],
      });
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('writes nothing when no date fits', async () => {
      Students.get.mockResolvedValue(
        activeStudent({ make_up_minutes: 0, make_up_batches: [] }),
      );
      const result = await service.createMakeupSet(request(), tutorUser, {
        now: NOW,
      });
      expect(result).toMatchObject({
        dry_run: false,
        accepted: [],
        created: 0,
        ids: [],
      });
      expect(result.series_id).toBeUndefined();
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('counts make-ups already scheduled with any tutor', async () => {
      scanResolves(Model, [{ ...slot(3, 30), tutor_id: 'someone-else' }]);
      const result = await service.createMakeupSet(request(), tutorUser, {
        dryRun: true,
        now: NOW,
      });
      expect(result.accepted).toEqual([]);
    });

    it('an admin creates a set for any tutor and any student; notes default to empty', async () => {
      Students.get.mockResolvedValue(
        activeStudent({ assigned_tutor_id: 'someone-else' }),
      );
      const result = await service.createMakeupSet(
        request({ tutor_id: 't-9', notes: undefined }),
        adminUser,
        { now: NOW },
      );
      expect(result.created).toBe(2);
      expect(Model.batchPut.mock.calls[0][0][0]).toMatchObject({
        tutor_id: 't-9',
        notes: '',
      });
    });

    it('a lead tutor creates a set for themselves', async () => {
      const result = await service.createMakeupSet(request(), leadUser, {
        now: NOW,
      });
      expect(result.created).toBe(2);
    });

    it.each([
      ['for another tutor', { tutor_id: 't-2' }, tutorUser],
      [
        'without being a tutor',
        {},
        { ...tutorUser, groups: undefined as unknown as string[] },
      ],
    ])('refuses a tutor creating a set %s', async (_what, over, user) => {
      await expect(
        service.createMakeupSet(request(over), user, { now: NOW }),
      ).rejects.toThrow('Unauthorized');
      expect(Students.get).not.toHaveBeenCalled();
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('refuses a tutor creating a set for a student who is not theirs', async () => {
      Students.get.mockResolvedValue(
        activeStudent({ assigned_tutor_id: 'someone-else' }),
      );
      await expect(
        service.createMakeupSet(request(), tutorUser, { now: NOW }),
      ).rejects.toThrow('Unauthorized');
      expect(Model.scan).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown student', async () => {
      Students.get.mockResolvedValue(undefined);
      await expect(
        service.createMakeupSet(request(), adminUser, { now: NOW }),
      ).rejects.toThrow('Student not found');
    });

    it('refuses a student who is not active', async () => {
      Students.get.mockResolvedValue(activeStudent({ status: 'Onboarding' }));
      await expect(
        service.createMakeupSet(request(), adminUser, { now: NOW }),
      ).rejects.toThrow(
        'Make-ups can only be scheduled for an active student.',
      );
    });

    it.each([
      ['no dates', { sessions: [] }, 'Choose at least one date.'],
      ['a missing list', { sessions: undefined }, 'Choose at least one date.'],
      [
        'more than 60 dates',
        { sessions: Array.from({ length: 61 }, (_, i) => slot(i + 1)) },
        'A set can hold at most 60 make-ups.',
      ],
      ['no student', { student_id: '' }, 'A student and a tutor are required.'],
      ['no tutor', { tutor_id: '' }, 'A student and a tutor are required.'],
      [
        'an unreadable date',
        { sessions: [{ start_datetime: 'x', end_datetime: 'y' }] },
        'Every make-up needs a start and a later end time.',
      ],
      [
        'an end before the start',
        {
          sessions: [
            {
              start_datetime: slot(1).end_datetime,
              end_datetime: slot(1).start_datetime,
            },
          ],
        },
        'Every make-up needs a start and a later end time.',
      ],
      [
        'a start in the past',
        { sessions: [slot(-1)] },
        'A make-up cannot start in the past.',
      ],
      [
        'a date beyond the look-ahead',
        {
          sessions: [
            {
              start_datetime: '2027-02-01T00:00:00.000Z',
              end_datetime: '2027-02-01T00:15:00.000Z',
            },
          ],
        },
        'Make-ups can be scheduled up to 3 months ahead.',
      ],
    ])('refuses %s', async (_what, over, message) => {
      await expect(
        service.createMakeupSet(request(over) as never, adminUser, {
          now: NOW,
        }),
      ).rejects.toThrow(message);
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('allows exactly 60 dates and the last moment of the look-ahead', async () => {
      Students.get.mockResolvedValue(
        activeStudent({
          make_up_never_expire: true,
          make_up_batches: [
            { minutes: 6000, earned_date: '2026-10-04T12:00:00.000Z' },
          ],
        }),
      );
      const sessions = [
        ...Array.from({ length: 59 }, (_, i) => slot(i + 1)),
        {
          start_datetime: '2027-01-31T23:45:00.000Z',
          end_datetime: '2027-02-01T00:00:00.000Z',
        },
      ];
      const result = await service.createMakeupSet(
        request({ sessions }),
        adminUser,
        { dryRun: true, now: NOW },
      );
      expect(result.accepted).toHaveLength(60);
    });

    it('rejects when the student or the sessions cannot be read', async () => {
      Students.get.mockRejectedValue(new Error('student boom'));
      await expect(
        service.createMakeupSet(request(), adminUser, { now: NOW }),
      ).rejects.toThrow('student boom');
      Students.get.mockResolvedValue(activeStudent());
      scanRejects(Model, new Error('scan boom'));
      await expect(
        service.createMakeupSet(request(), adminUser, { now: NOW }),
      ).rejects.toThrow('scan boom');
    });

    it('uses the current time and a real write by default', async () => {
      const soon = new Date(Date.now() + 86400000);
      Students.get.mockResolvedValue(
        activeStudent({
          make_up_batches: [
            { minutes: 30, earned_date: new Date().toISOString() },
          ],
        }),
      );
      const result = await service.createMakeupSet(
        request({
          sessions: [
            {
              start_datetime: soon.toISOString(),
              end_datetime: new Date(soon.getTime() + 900000).toISOString(),
            },
          ],
        }),
        adminUser,
      );
      expect(result).toMatchObject({ dry_run: false, created: 1 });
    });
  });

  describe('getScheduledMakeupMinutes', () => {
    const makeup = (over: Partial<Session> = {}): Session =>
      sampleSession({ type: SessionType.MAKE_UP, ...over });

    it('sums pending make-up minutes per student across every tutor', async () => {
      scanResolves(Model, [
        makeup({ student_id: 'a', tutor_id: 't-1' }), // 60
        makeup({
          student_id: 'a',
          tutor_id: 't-2',
          start_datetime: '2026-01-02T10:00:00Z',
          end_datetime: '2026-01-02T10:15:00Z',
        }), // 15
        makeup({
          student_id: 'b',
          start_datetime: '2026-01-03T10:00:00Z',
          end_datetime: '2026-01-03T10:30:00Z',
        }), // 30
        makeup({ student_id: undefined }), // nobody to count it for
        makeup({ student_id: 'c', end_datetime: 'not a date' }), // 0 minutes
      ]);
      await expect(service.getScheduledMakeupMinutes()).resolves.toEqual([
        { student_id: 'a', scheduled_minutes: 75 },
        { student_id: 'b', scheduled_minutes: 30 },
      ]);
      expect(Model.scan).toHaveBeenCalledWith({
        type: { eq: 'MAKE_UP' },
        status: { eq: 'Pending' },
      });
      // An admin read needs no student lookup.
      expect(Students.scan).not.toHaveBeenCalled();
    });

    it('limits a tutor to the students they can see, still counting other tutors', async () => {
      Model.scan.mockReturnValueOnce({
        all: () => ({
          exec: () =>
            Promise.resolve([
              makeup({ student_id: 'mine', tutor_id: 'someone-else' }),
              makeup({ student_id: 'slot', tutor_id: 't-1' }),
              makeup({ student_id: 'theirs', tutor_id: 't-1' }),
            ]),
        }),
      });
      scanResolves(Students, [
        { id: 'mine', assigned_tutor_id: 't-1' },
        {
          id: 'slot',
          assigned_tutor_id: 't-9',
          schedule: [{ tutor_id: 't-1' }],
        },
        { id: 'theirs', assigned_tutor_id: 't-9', schedule: [null] },
        { assigned_tutor_id: 't-1' },
      ]);
      await expect(service.getScheduledMakeupMinutes('t-1')).resolves.toEqual([
        { student_id: 'mine', scheduled_minutes: 60 },
        { student_id: 'slot', scheduled_minutes: 60 },
      ]);
      expect(Students.scan).toHaveBeenCalledTimes(1);
    });

    it('is empty when nothing is scheduled', async () => {
      scanResolves(Model, []);
      await expect(service.getScheduledMakeupMinutes()).resolves.toEqual([]);
    });

    it('rejects when the sessions or the students cannot be read', async () => {
      scanRejects(Model, new Error('sessions boom'));
      await expect(service.getScheduledMakeupMinutes()).rejects.toThrow(
        'sessions boom',
      );
      scanResolves(Model, [makeup()]);
      Students.scan.mockReturnValueOnce({
        all: () => ({ exec: () => Promise.reject(new Error('students boom')) }),
      });
      await expect(service.getScheduledMakeupMinutes('t-1')).rejects.toThrow(
        'students boom',
      );
    });
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

    it('persists a GROUP session roster through create', async () => {
      Model.__save.mockResolvedValue(undefined);
      const participants = [
        { id: 's-a', name: 'Ava' },
        { id: 's-b', name: 'Ben' },
      ];
      await service.createSession(sampleSession({ participants }));
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({ participants }),
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

    it('persists rosters through the batch path', async () => {
      Model.batchPut.mockResolvedValue(undefined);
      const participants = [{ id: 's-a', name: 'Ava' }];
      await service.createSessions([sampleSession({ participants })]);
      const batch = Model.batchPut.mock.calls[0][0];
      expect(batch[0].participants).toEqual(participants);
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

    it('omits undefined attributes — a non-GROUP session must not send participants', async () => {
      // Regression: dynamoose wraps a non-array value for the array-typed
      // participants attribute into [undefined] and rejects the update
      // ("Expected participants.0 to be of type object"), which broke every
      // tutoring/trial/make-up session edit.
      Model.update.mockResolvedValue(sampleSession());
      await service.updateSession(sampleSession());
      const attributes = Model.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect('participants' in attributes).toBe(false);
      expect(Object.values(attributes)).not.toContain(undefined);
    });

    it('persists a roster change through update', async () => {
      const participants = [{ id: 's-c', name: 'Cy' }];
      Model.update.mockResolvedValue(sampleSession());
      await service.updateSession(sampleSession({ participants }));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ participants }),
      );
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

    it('sends a branded HTML alternative with the notes escaped and line breaks kept', async () => {
      Model.get.mockResolvedValue(
        completed({
          notes: 'Reviewed <fractions> & decimals.\nHomework: p. 12',
        }),
      );
      await service.emailSessionNotes('session-1');
      const send = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
      const html = send.Message?.Body?.Html?.Data ?? '';
      expect(send.Message?.Body?.Html?.Charset).toBe('UTF-8');
      expect(html).toContain(
        'https://btchub.bitshiftstudio.io/assets/BTC_Transparent_BG.png',
      );
      expect(html).toContain('Session notes for Pat</h1>');
      expect(html).toContain('Hi Jane,');
      expect(html).toContain(
        'Reviewed &lt;fractions&gt; &amp; decimals.<br>Homework: p. 12',
      );
      expect(html).not.toContain('<fractions>');
      // The text alternative carries the raw notes.
      expect(send.Message?.Body?.Text?.Data).toContain(
        'Reviewed <fractions> & decimals.\nHomework: p. 12',
      );
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
      expect(send.Message?.Body?.Text?.Data).toContain(
        '— Beyond the Chalkboard Tutoring',
      );
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

  describe('setAttendance', () => {
    const NOW = new Date('2026-09-28T16:00:00.000Z');
    const START = '2026-09-21T14:00:00.000Z';
    const stored = (over: Partial<Session> = {}): Session =>
      sampleSession({
        start_datetime: START,
        end_datetime: '2026-09-21T15:00:00.000Z',
        tutor_id: 'c-tutor',
        ...over,
      });
    const pat = (over: Record<string, unknown> = {}) => ({
      id: 'student-1',
      name: 'Pat',
      make_up_minutes: 120,
      make_up_batches: [
        { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
      ],
      ...over,
    });
    const admin = {
      username: 'a',
      email: 'a@x.com',
      groups: ['Admins'],
      contact: 'c-admin',
    };
    const tutor = {
      username: 't',
      email: 't@x.com',
      groups: ['Tutors'],
      contact: 'c-tutor',
    };
    const lead = { ...tutor, groups: ['LeadTutors'], contact: 'c-lead' };
    const take = (
      request: Record<string, unknown>,
      user: typeof admin = tutor,
      dryRun = false,
    ) =>
      service.setAttendance('session-1', request as never, user, {
        dryRun,
        now: NOW,
      });

    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      Model.get.mockResolvedValue(stored());
      Model.update.mockImplementation((_key: unknown, attrs: object) =>
        Promise.resolve({ ...stored(), ...attrs }),
      );
      Students.get.mockResolvedValue(pat());
      Students.update.mockResolvedValue({});
      Contacts.get.mockResolvedValue({ first_name: 'Tess', last_name: 'One' });
    });

    describe('first attendance', () => {
      it('the session tutor completes a tutoring session: status, notes and history, no minutes moved', async () => {
        const res = await take({ status: 'Completed', notes: 'Went well' });
        expect(Students.update).not.toHaveBeenCalled();
        expect(Model.update).toHaveBeenCalledWith(
          { id: 'session-1' },
          {
            status: 'Completed',
            notes: 'Went well',
            attendance_history: [
              {
                from: 'Pending',
                to: 'Completed',
                by: 'c-tutor',
                by_name: 'Tess One',
                at: NOW.toISOString(),
                minutes_delta: 0,
              },
            ],
          },
        );
        expect(res.dry_run).toBe(false);
        expect(res.session.status).toBe('Completed');
        expect(res.makeup).toEqual({
          before: 120,
          after: 120,
          delta: 0,
          unrecovered: 0,
        });
      });

      it('a cancelled tutoring session banks its minutes on the student, then saves the session', async () => {
        const res = await take({ status: 'Cancelled' });
        expect(Students.update).toHaveBeenCalledWith(
          { id: 'student-1' },
          {
            make_up_minutes: 180,
            make_up_batches: [
              { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
              { minutes: 60, earned_date: START },
            ],
          },
        );
        expect(Students.update.mock.invocationCallOrder[0]).toBeLessThan(
          Model.update.mock.invocationCallOrder[0],
        );
        const attrs = Model.update.mock.calls[0][1];
        expect(attrs.attendance_history[0].minutes_delta).toBe(60);
        expect('notes' in attrs).toBe(false);
        expect(res.makeup.after).toBe(180);
      });

      it('a make-up that uses the last minutes clears the batch list', async () => {
        Model.get.mockResolvedValue(
          stored({
            type: SessionType.MAKE_UP,
            end_datetime: '2026-09-21T16:00:00.000Z',
          }),
        );
        await take({ status: 'Completed' });
        expect(Students.update).toHaveBeenCalledWith(
          { id: 'student-1' },
          { $SET: { make_up_minutes: 0 }, $REMOVE: ['make_up_batches'] },
        );
      });

      it('refuses a make-up the student has no minutes for', async () => {
        Model.get.mockResolvedValue(stored({ type: SessionType.MAKE_UP }));
        Students.get.mockResolvedValue(
          pat({
            make_up_batches: [{ minutes: 20, earned_date: START }],
          }),
        );
        await expect(take({ status: 'Completed' })).rejects.toThrow(
          'Not enough make-up minutes. Pat has 20 min but this session requires 60 min.',
        );
        await expect(take({ status: 'NCNS' })).rejects.toThrow(
          BadRequestException,
        );
        // Cancelling it needs no minutes.
        await expect(take({ status: 'Cancelled' })).resolves.toBeDefined();
        expect(Students.update).not.toHaveBeenCalled();
      });

      it('names a nameless student generically', async () => {
        Model.get.mockResolvedValue(stored({ type: SessionType.MAKE_UP }));
        Students.get.mockResolvedValue(
          pat({ name: undefined, make_up_batches: [], make_up_minutes: 0 }),
        );
        await expect(take({ status: 'Completed' })).rejects.toThrow(
          'Not enough make-up minutes. The student has 0 min',
        );
      });

      it('an admin and a lead on their own session may take it too', async () => {
        await expect(
          take({ status: 'Completed' }, admin),
        ).resolves.toBeDefined();
        Model.get.mockResolvedValue(stored({ tutor_id: 'c-lead' }));
        await expect(
          take({ status: 'Completed' }, lead),
        ).resolves.toBeDefined();
      });

      it('a session without a student never loads one', async () => {
        Model.get.mockResolvedValue(
          stored({ type: SessionType.GROUP, student_id: undefined }),
        );
        const res = await take({ status: 'Completed' });
        expect(Students.get).not.toHaveBeenCalled();
        expect(res.makeup).toEqual({
          before: 0,
          after: 0,
          delta: 0,
          unrecovered: 0,
        });
      });

      it('a session with no stored status counts as pending', async () => {
        Model.get.mockResolvedValue(
          stored({ status: undefined as unknown as string }),
        );
        await take({ status: 'Completed' });
        expect(Model.update.mock.calls[0][1].attendance_history[0].from).toBe(
          'Pending',
        );
        await expect(take({ status: 'Pending' })).rejects.toThrow(
          'The session is already Pending.',
        );
      });
    });

    describe('who may not', () => {
      it('another tutor, a lead on a team member session, or a stranger', async () => {
        for (const user of [
          { ...tutor, contact: 'c-other' },
          lead,
          { ...tutor, groups: [] },
          { ...tutor, groups: undefined as unknown as string[] },
          { ...tutor, contact: '' },
        ]) {
          await expect(take({ status: 'Completed' }, user)).rejects.toThrow(
            'Unauthorized',
          );
        }
        expect(Model.update).not.toHaveBeenCalled();
        expect(Students.get).not.toHaveBeenCalled();
      });

      it('the tutor, once attendance was taken', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow(
          'Attendance is final. Ask an admin to correct it.',
        );
        await expect(
          take({ status: 'Pending', reason: 'please' }),
        ).rejects.toThrow('Attendance is final. Ask an admin to correct it.');
        expect(Model.update).not.toHaveBeenCalled();
      });
    });

    describe('validation', () => {
      it.each([[undefined], [''], ['Done'], ['completed'], [5]])(
        'rejects the status %p',
        async (status) => {
          await expect(take({ status })).rejects.toThrow(
            'status must be one of: Pending, Completed, Cancelled, NCNS.',
          );
          expect(Model.get).not.toHaveBeenCalled();
        },
      );

      it('rejects a missing request', async () => {
        await expect(
          service.setAttendance('session-1', undefined as never, tutor),
        ).rejects.toThrow('status must be one of');
      });

      it('404s on a session that does not exist', async () => {
        Model.get.mockResolvedValue(undefined);
        await expect(take({ status: 'Completed' })).rejects.toThrow(
          NotFoundException,
        );
      });

      it('rejects the status the session already has', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        await expect(
          take({ status: 'Completed', reason: 'x' }, admin),
        ).rejects.toThrow('The session is already Completed.');
      });

      it('rejects when the student cannot be loaded', async () => {
        Students.get.mockRejectedValue(new Error('down'));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow('down');
        expect(Model.update).not.toHaveBeenCalled();
      });
    });

    describe('admin correction', () => {
      const banked = () =>
        pat({
          make_up_minutes: 180,
          make_up_batches: [
            { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
            { minutes: 60, earned_date: START },
          ],
        });

      it.each([[undefined], [''], ['   ']])(
        'needs a reason (%p)',
        async (reason) => {
          Model.get.mockResolvedValue(stored({ status: 'Cancelled' }));
          await expect(
            take({ status: 'Completed', reason }, admin),
          ).rejects.toThrow(
            'A reason is required to change attendance that was already taken.',
          );
          expect(Model.update).not.toHaveBeenCalled();
          expect(Students.update).not.toHaveBeenCalled();
        },
      );

      it('Cancelled → Completed takes the banked minutes back and records why', async () => {
        Model.get.mockResolvedValue(
          stored({
            status: 'Cancelled',
            attendance_history: [
              {
                from: 'Pending',
                to: 'Cancelled',
                by: 'c-tutor',
                at: '2026-09-21T15:05:00.000Z',
              },
              null as never,
            ],
          }),
        );
        Students.get.mockResolvedValue(banked());
        Contacts.get.mockResolvedValue({ first_name: 'Abby' });
        const res = await take(
          { status: 'Completed', reason: '  Marked the wrong session  ' },
          admin,
        );
        expect(Students.update).toHaveBeenCalledWith(
          { id: 'student-1' },
          {
            make_up_minutes: 120,
            make_up_batches: [
              { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
            ],
          },
        );
        expect(Model.update.mock.calls[0][1].attendance_history).toEqual([
          {
            from: 'Pending',
            to: 'Cancelled',
            by: 'c-tutor',
            at: '2026-09-21T15:05:00.000Z',
          },
          {
            from: 'Cancelled',
            to: 'Completed',
            by: 'c-admin',
            by_name: 'Abby',
            at: NOW.toISOString(),
            reason: 'Marked the wrong session',
            minutes_delta: -60,
          },
        ]);
        expect(res.makeup).toEqual({
          before: 180,
          after: 120,
          delta: -60,
          unrecovered: 0,
        });
      });

      it('records minutes that could not be taken back', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Cancelled' }));
        Students.get.mockResolvedValue(
          pat({
            make_up_batches: [
              { minutes: 25, earned_date: '2026-09-01T14:00:00.000Z' },
            ],
          }),
        );
        const res = await take({ status: 'Completed', reason: 'fix' }, admin);
        expect(res.makeup).toEqual({
          before: 25,
          after: 0,
          delta: -25,
          unrecovered: 35,
        });
        expect(Model.update.mock.calls[0][1].attendance_history[0]).toEqual(
          expect.objectContaining({ minutes_delta: -25, unrecovered: 35 }),
        );
      });

      it('a make-up correction with too few minutes goes through and reports the shortfall', async () => {
        Model.get.mockResolvedValue(
          stored({ type: SessionType.MAKE_UP, status: 'Cancelled' }),
        );
        Students.get.mockResolvedValue(
          pat({ make_up_batches: [{ minutes: 20, earned_date: START }] }),
        );
        const res = await take({ status: 'Completed', reason: 'fix' }, admin);
        expect(res.makeup.unrecovered).toBe(40);
        expect(Model.update).toHaveBeenCalled();
      });

      it('an admin may reopen a session to Pending', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Cancelled' }));
        Students.get.mockResolvedValue(banked());
        const res = await take(
          { status: 'Pending', reason: 'wrong day' },
          admin,
        );
        expect(res.session.status).toBe('Pending');
        expect(res.makeup.delta).toBe(-60);
      });

      it('Completed ↔ NCNS moves no minutes and writes no student', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        await take({ status: 'NCNS', reason: 'no show' }, admin);
        expect(Students.update).not.toHaveBeenCalled();
        expect(Model.update.mock.calls[0][1].attendance_history[0]).toEqual(
          expect.objectContaining({ minutes_delta: 0 }),
        );
      });

      it('tolerates an unknown admin name', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        Contacts.get.mockRejectedValue(new Error('down'));
        await take({ status: 'NCNS', reason: 'x' }, admin);
        expect(
          'by_name' in Model.update.mock.calls[0][1].attendance_history[0],
        ).toBe(false);
        Contacts.get.mockResolvedValue(undefined);
        await take({ status: 'NCNS', reason: 'x' }, admin);
        expect(
          'by_name' in Model.update.mock.calls[1][1].attendance_history[0],
        ).toBe(false);
        Contacts.get.mockResolvedValue({ last_name: 'Reed' });
        await take({ status: 'NCNS', reason: 'x' }, admin);
        expect(
          Model.update.mock.calls[2][1].attendance_history[0].by_name,
        ).toBe('Reed');
      });
    });

    describe('dry run', () => {
      it('returns the plan and writes nothing', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        const res = await take(
          { status: 'Cancelled', reason: 'preview', notes: 'n' },
          admin,
          true,
        );
        expect(res).toEqual({
          session: { ...stored({ status: 'Cancelled' }), notes: 'n' },
          makeup: { before: 120, after: 180, delta: 60, unrecovered: 0 },
          dry_run: true,
        });
        expect(Model.update).not.toHaveBeenCalled();
        expect(Students.update).not.toHaveBeenCalled();
        expect(Contacts.get).not.toHaveBeenCalled();
      });

      it('keeps the stored notes when none are sent', async () => {
        Model.get.mockResolvedValue(stored({ notes: 'kept' }));
        const res = await take({ status: 'Completed' }, tutor, true);
        expect(res.session.notes).toBe('kept');
        const typed = await take(
          { status: 'Completed', notes: 5 },
          tutor,
          true,
        );
        expect(typed.session.notes).toBe('kept');
      });

      it('still enforces the role and the reason', async () => {
        Model.get.mockResolvedValue(stored({ status: 'Completed' }));
        await expect(
          take({ status: 'Cancelled' }, tutor, true),
        ).rejects.toThrow('Attendance is final');
        await expect(
          take({ status: 'Cancelled' }, admin, true),
        ).rejects.toThrow('A reason is required');
      });
    });

    describe('failures', () => {
      it('a failed student write stops before the session is touched', async () => {
        Students.update.mockRejectedValue(new Error('student boom'));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow(
          'student boom',
        );
        expect(Model.update).not.toHaveBeenCalled();
      });

      it('a failed session write puts the minutes back', async () => {
        Model.update.mockRejectedValue(new Error('session boom'));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow(
          'session boom',
        );
        expect(Students.update).toHaveBeenCalledTimes(2);
        expect(Students.update).toHaveBeenLastCalledWith(
          { id: 'student-1' },
          {
            make_up_minutes: 120,
            make_up_batches: [
              { minutes: 120, earned_date: '2026-09-01T14:00:00.000Z' },
            ],
          },
        );
      });

      it('restores a student who had no batches by removing the list', async () => {
        Students.get.mockResolvedValue(
          pat({ make_up_minutes: undefined, make_up_batches: [null] }),
        );
        Model.update.mockRejectedValue(new Error('session boom'));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow(
          'session boom',
        );
        expect(Students.update).toHaveBeenLastCalledWith(
          { id: 'student-1' },
          { $SET: { make_up_minutes: 0 }, $REMOVE: ['make_up_batches'] },
        );
      });

      it('still reports the session failure when the restore fails too', async () => {
        Model.update.mockRejectedValue(new Error('session boom'));
        Students.update
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('restore boom'));
        await expect(take({ status: 'Cancelled' })).rejects.toThrow(
          'session boom',
        );
      });

      it('restores nothing when no minutes moved', async () => {
        Model.update.mockRejectedValue(new Error('session boom'));
        await expect(take({ status: 'Completed' })).rejects.toThrow(
          'session boom',
        );
        expect(Students.update).not.toHaveBeenCalled();
      });
    });

    it('defaults to the current time and a real write', async () => {
      const res = await service.setAttendance(
        'session-1',
        { status: 'Completed' },
        tutor,
      );
      expect(res.dry_run).toBe(false);
      expect(Model.update).toHaveBeenCalled();
    });
  });
});
