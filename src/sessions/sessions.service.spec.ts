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
