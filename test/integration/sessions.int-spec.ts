import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionsController } from '../../src/sessions/sessions.controller';
import { SessionsService } from '../../src/sessions/sessions.service';
import { TeamsService } from '../../src/teams/teams.service';
import { SessionsModel } from '../../src/models/sessions.model';
import { TeamsModel } from '../../src/models/teams.model';
import { StudentsModel } from '../../src/models/students.model';
import { ContactsModel } from '../../src/models/contacts.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/sessions.model', () => ({
  SessionsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/teams.model', () => ({
  TeamsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/students.model', () => ({
  StudentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));

const Model = SessionsModel as unknown as ModelMock;
const TeamModel = TeamsModel as unknown as ModelMock;
const StudentModel = StudentsModel as unknown as ModelMock;
const ContactModel = ContactsModel as unknown as ModelMock;

describe('Sessions (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [SessionsController],
      providers: [SessionsService, TeamsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('admin lists every session with no query params', async () => {
    scanResolves(Model, [{ id: 's-1' }]);
    const res = await request(server())
      .get('/sessions')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(Model.scan).toHaveBeenCalledWith();
  });

  it('a tutor can read their own sessions by tutor id', async () => {
    scanResolves(Model, []);
    const res = await request(server())
      .get('/sessions?tutor=contact-tutor')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(200);
    expect(Model.scan).toHaveBeenCalledWith({
      tutor_id: { eq: 'contact-tutor' },
    });
  });

  it('a tutor cannot read another tutor sessions', async () => {
    const res = await request(server())
      .get('/sessions?tutor=other@example.com')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(403);
    expect(Model.scan).not.toHaveBeenCalled();
  });

  it('a stranger cannot list sessions', async () => {
    const res = await request(server())
      .get('/sessions')
      .set('x-test-role', 'none');
    expect(res.status).toBe(403);
  });

  it('admin creates a session', async () => {
    Model.__save.mockResolvedValue(undefined);
    const res = await request(server())
      .post('/sessions')
      .set('x-test-role', 'admin')
      .send({ tutor_id: 'tutor@example.com', status: 'Pending' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Session created successfully.');
  });

  it('scheduled make-up minutes: an admin gets all, a tutor only their students, a stranger nothing', async () => {
    const pending = [
      {
        type: 'MAKE_UP',
        status: 'Pending',
        student_id: 'st-1',
        start_datetime: '2026-10-10T14:00:00.000Z',
        end_datetime: '2026-10-10T14:30:00.000Z',
      },
      {
        type: 'MAKE_UP',
        status: 'Pending',
        student_id: 'st-2',
        start_datetime: '2026-10-11T14:00:00.000Z',
        end_datetime: '2026-10-11T15:00:00.000Z',
      },
    ];
    scanResolves(Model, pending);
    const asAdmin = await request(server())
      .get('/sessions/makeup-scheduled')
      .set('x-test-role', 'admin');
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toEqual([
      { student_id: 'st-1', scheduled_minutes: 30 },
      { student_id: 'st-2', scheduled_minutes: 60 },
    ]);

    scanResolves(Model, pending);
    scanResolves(StudentModel, [
      { id: 'st-1', assigned_tutor_id: 'contact-tutor' },
      { id: 'st-2', assigned_tutor_id: 'someone-else' },
    ]);
    const asTutor = await request(server())
      .get('/sessions/makeup-scheduled')
      .set('x-test-role', 'tutor');
    expect(asTutor.status).toBe(200);
    expect(asTutor.body).toEqual([
      { student_id: 'st-1', scheduled_minutes: 30 },
    ]);

    const asStranger = await request(server())
      .get('/sessions/makeup-scheduled')
      .set('x-test-role', 'none');
    expect(asStranger.status).toBe(403);
  });

  describe('make-up set', () => {
    const soon = (days: number, minutes = 15) => {
      const start = new Date(Date.now() + days * 86400000);
      return {
        start_datetime: start.toISOString(),
        end_datetime: new Date(start.getTime() + minutes * 60000).toISOString(),
      };
    };
    const body = () => ({
      student_id: 'st-1',
      tutor_id: 'contact-tutor',
      tutor_name: 'Tess',
      sessions: [soon(1), soon(8), soon(15)],
    });

    beforeEach(() => {
      jest.clearAllMocks();
      StudentModel.get.mockResolvedValue({
        id: 'st-1',
        name: 'Pat',
        status: 'Active Student',
        assigned_tutor_id: 'contact-tutor',
        make_up_minutes: 30,
        make_up_batches: [
          { minutes: 30, earned_date: new Date().toISOString() },
        ],
      });
      scanResolves(Model, []);
      Model.batchPut.mockResolvedValue(undefined);
    });

    it('a dry run previews the set and writes nothing', async () => {
      const res = await request(server())
        .post('/sessions/makeup-set?dry_run=true')
        .set('x-test-role', 'tutor')
        .send(body());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        dry_run: true,
        accepted: [0, 1],
        skipped: [{ index: 2, reason: 'insufficient' }],
        minutes_used: 30,
        created: 0,
      });
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('a tutor creates a set for their own student under one series', async () => {
      const res = await request(server())
        .post('/sessions/makeup-set')
        .set('x-test-role', 'tutor')
        .send(body());
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(2);
      const written = Model.batchPut.mock.calls[0][0];
      expect(written).toHaveLength(2);
      expect(
        new Set(written.map((s: { series_id: string }) => s.series_id)).size,
      ).toBe(1);
      expect(written[0]).toMatchObject({
        type: 'MAKE_UP',
        tutor_id: 'contact-tutor',
        student_id: 'st-1',
      });
    });

    it('a tutor cannot create a set for another tutor, or for a student who is not theirs', async () => {
      const other = await request(server())
        .post('/sessions/makeup-set')
        .set('x-test-role', 'tutor')
        .send({ ...body(), tutor_id: 'someone-else' });
      expect(other.status).toBe(403);

      StudentModel.get.mockResolvedValue({
        id: 'st-1',
        status: 'Active Student',
        assigned_tutor_id: 'someone-else',
      });
      const notTheirs = await request(server())
        .post('/sessions/makeup-set')
        .set('x-test-role', 'tutor')
        .send(body());
      expect(notTheirs.status).toBe(403);
      expect(Model.batchPut).not.toHaveBeenCalled();
    });

    it('a malformed request is refused before anything is read', async () => {
      const res = await request(server())
        .post('/sessions/makeup-set')
        .set('x-test-role', 'admin')
        .send({
          student_id: 'st-1',
          tutor_id: 't',
          sessions: [{ start_datetime: 'x', end_datetime: 'y' }],
        });
      expect(res.status).toBe(400);
      expect(StudentModel.get).not.toHaveBeenCalled();
    });

    it('a tutor reads a series as far as it is theirs', async () => {
      scanResolves(Model, [
        { id: 'a', series_id: 'set-1', tutor_id: 'contact-tutor' },
        { id: 'b', series_id: 'set-1', tutor_id: 'someone-else' },
      ]);
      const res = await request(server())
        .get('/sessions?series=set-1')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(200);
      expect(res.body.map((s: { id: string }) => s.id)).toEqual(['a']);
    });
  });

  it('only an admin creates a custom trial', async () => {
    Model.__save.mockResolvedValue(undefined);
    const custom = {
      type: 'CUSTOM_TRIAL',
      tutor_id: 'contact-tutor',
      student_id: 'st-1',
      status: 'Pending',
    };
    const asAdmin = await request(server())
      .post('/sessions')
      .set('x-test-role', 'admin')
      .send(custom);
    expect(asAdmin.status).toBe(201);
    expect(Model).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CUSTOM_TRIAL', student_id: 'st-1' }),
    );

    Model.mockClear();
    const asTutor = await request(server())
      .post('/sessions')
      .set('x-test-role', 'tutor')
      .send(custom);
    expect(asTutor.status).toBe(403);
    expect(Model).not.toHaveBeenCalled();
  });

  it('a tutor cannot change the type of their own session; an admin can', async () => {
    Model.get.mockResolvedValue({
      id: 's-1',
      tutor_id: 'contact-tutor',
      type: 'MAKE_UP',
      status: 'Pending',
    });
    Model.update.mockResolvedValue({ id: 's-1' });
    const change = { id: 's-1', tutor_id: 'contact-tutor', type: 'ADMIN' };
    const asTutor = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send(change);
    expect(asTutor.status).toBe(403);
    expect(asTutor.body.message).toBe(
      'Only an admin can change the session type.',
    );
    expect(Model.update).not.toHaveBeenCalled();

    const asAdmin = await request(server())
      .put('/sessions')
      .set('x-test-role', 'admin')
      .send(change);
    expect(asAdmin.status).toBe(200);
    expect(Model.update).toHaveBeenCalledTimes(1);
  });

  it('a tutor may update their own stored session but not others', async () => {
    Model.get.mockResolvedValue({ id: 's-1', tutor_id: 'contact-tutor' });
    Model.update.mockResolvedValue({ id: 's-1' });
    const ok = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-1', tutor_id: 'contact-tutor' });
    expect(ok.status).toBe(200);
    expect(Model.get).toHaveBeenCalledWith('s-1');

    const denied = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-2', tutor_id: 'other@example.com' });
    expect(denied.status).toBe(403);
  });

  it('a tutor cannot hijack a session stored under another tutor', async () => {
    // Payload claims the caller, but the stored record says otherwise.
    Model.get.mockResolvedValue({ id: 's-9', tutor_id: 'contact-other' });
    const res = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-9', tutor_id: 'contact-tutor' });
    expect(res.status).toBe(403);
    expect(Model.update).not.toHaveBeenCalled();
  });

  it('a lead with a (nested) team gets the whole team sessions on the parameterless GET', async () => {
    TeamModel.scan.mockClear();
    // One full scan of the teams table resolves membership transitively:
    // the lead's team lists another lead, whose own team comes along.
    scanResolves(TeamModel, [
      {
        id: 'team-1',
        name: 'Team A',
        lead_contact_id: 'contact-lead',
        member_contact_ids: ['contact-tutor', 'contact-sublead'],
      },
      {
        id: 'team-2',
        name: 'Team B',
        lead_contact_id: 'contact-sublead',
        member_contact_ids: ['contact-nested'],
      },
    ]);
    const chain = scanResolves(Model, [{ id: 's-1' }]);
    const res = await request(server())
      .get('/sessions')
      .set('x-test-role', 'lead');
    expect(res.status).toBe(200);
    expect(TeamModel.scan).toHaveBeenCalledWith();
    expect(chain.where).toHaveBeenCalledWith('tutor_id');
    expect(chain.in).toHaveBeenCalledWith([
      'contact-lead',
      'contact-tutor',
      'contact-sublead',
      'contact-nested',
    ]);
  });

  it('a lead with no team gets their own sessions on the parameterless GET', async () => {
    scanResolves(TeamModel, []);
    scanResolves(Model, []);
    const res = await request(server())
      .get('/sessions')
      .set('x-test-role', 'lead');
    expect(res.status).toBe(200);
    expect(Model.scan).toHaveBeenCalledWith({
      tutor_id: { eq: 'contact-lead' },
    });
  });

  it('a lead cannot fetch a specific other tutor directly', async () => {
    const res = await request(server())
      .get('/sessions?tutor=contact-tutor')
      .set('x-test-role', 'lead');
    expect(res.status).toBe(403);
  });

  it('a lead may update their own stored session but not a member session', async () => {
    Model.get.mockResolvedValue({ id: 's-1', tutor_id: 'contact-lead' });
    Model.update.mockResolvedValue({ id: 's-1' });
    const ok = await request(server())
      .put('/sessions')
      .set('x-test-role', 'lead')
      .send({ id: 's-1', tutor_id: 'contact-lead' });
    expect(ok.status).toBe(200);

    const denied = await request(server())
      .put('/sessions')
      .set('x-test-role', 'lead')
      .send({ id: 's-2', tutor_id: 'contact-tutor' });
    expect(denied.status).toBe(403);
  });

  describe('attendance', () => {
    const START = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const END = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 's-1',
      type: 'TUTORING',
      status: 'Pending',
      notes: '',
      start_datetime: START,
      end_datetime: END,
      student_id: 'st-1',
      tutor_id: 'contact-tutor',
      tutor_name: 'Tess',
      ...over,
    });

    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      Model.get.mockResolvedValue(stored());
      Model.update.mockImplementation((_k: unknown, attrs: object) =>
        Promise.resolve({ ...stored(), ...attrs }),
      );
      StudentModel.get.mockResolvedValue({
        id: 'st-1',
        name: 'Pat',
        make_up_minutes: 0,
      });
      StudentModel.update.mockResolvedValue({});
      ContactModel.get.mockResolvedValue({ first_name: 'Abby' });
    });

    it('a tutor takes attendance on their own session; a cancellation banks the minutes', async () => {
      const res = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'tutor')
        .send({ status: 'Cancelled', notes: 'Family cancelled' });
      expect(res.status).toBe(200);
      expect(res.body.makeup).toEqual({
        before: 0,
        after: 60,
        delta: 60,
        unrecovered: 0,
      });
      expect(res.body.session.status).toBe('Cancelled');
      expect(StudentModel.update).toHaveBeenCalledWith(
        { id: 'st-1' },
        {
          make_up_minutes: 60,
          make_up_batches: [{ minutes: 60, earned_date: START }],
        },
      );
    });

    it('cancelling a custom trial banks no make-up minutes', async () => {
      Model.get.mockResolvedValue(stored({ type: 'CUSTOM_TRIAL' }));
      const res = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'tutor')
        .send({ status: 'Cancelled', notes: 'Family cancelled' });
      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe('Cancelled');
      expect(res.body.makeup).toMatchObject({ delta: 0, unrecovered: 0 });
      expect(StudentModel.update).not.toHaveBeenCalled();
    });

    it('a tutor cannot change attendance that was already taken', async () => {
      Model.get.mockResolvedValue(stored({ status: 'Completed' }));
      const viaAttendance = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'tutor')
        .send({ status: 'Cancelled', reason: 'oops' });
      expect(viaAttendance.status).toBe(403);
      const viaUpdate = await request(server())
        .put('/sessions')
        .set('x-test-role', 'tutor')
        .send(stored({ status: 'Pending' }));
      expect(viaUpdate.status).toBe(403);
      const moved = await request(server())
        .put('/sessions')
        .set('x-test-role', 'tutor')
        .send(
          stored({
            status: 'Completed',
            start_datetime: new Date().toISOString(),
          }),
        );
      expect(moved.status).toBe(403);
      expect(Model.update).not.toHaveBeenCalled();
      expect(StudentModel.update).not.toHaveBeenCalled();
    });

    it('a tutor may still edit the notes of a finalized session', async () => {
      Model.get.mockResolvedValue(stored({ status: 'Completed' }));
      const res = await request(server())
        .put('/sessions')
        .set('x-test-role', 'tutor')
        .send(stored({ status: 'Completed', notes: 'fixed a typo' }));
      expect(res.status).toBe(200);
      expect(Model.update).toHaveBeenCalled();
    });

    it('an admin corrects attendance with a reason; without one it is refused', async () => {
      Model.get.mockResolvedValue(stored({ status: 'Cancelled' }));
      StudentModel.get.mockResolvedValue({
        id: 'st-1',
        name: 'Pat',
        make_up_minutes: 60,
        make_up_batches: [{ minutes: 60, earned_date: START }],
      });
      const refused = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'admin')
        .send({ status: 'Completed' });
      expect(refused.status).toBe(400);

      const res = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'admin')
        .send({ status: 'Completed', reason: 'Marked the wrong session' });
      expect(res.status).toBe(200);
      expect(res.body.makeup.delta).toBe(-60);
      expect(res.body.session.attendance_history.at(-1)).toEqual(
        expect.objectContaining({
          from: 'Cancelled',
          to: 'Completed',
          by: 'contact-admin',
          reason: 'Marked the wrong session',
        }),
      );
    });

    it('a dry run previews the change and writes nothing', async () => {
      const res = await request(server())
        .put('/sessions/s-1/attendance?dry_run=true')
        .set('x-test-role', 'tutor')
        .send({ status: 'Cancelled' });
      expect(res.status).toBe(200);
      expect(res.body.dry_run).toBe(true);
      expect(res.body.makeup.delta).toBe(60);
      expect(Model.update).not.toHaveBeenCalled();
      expect(StudentModel.update).not.toHaveBeenCalled();
    });

    it('another tutor is refused and an unknown session is a 404', async () => {
      Model.get.mockResolvedValue(stored({ tutor_id: 'someone-else' }));
      const other = await request(server())
        .put('/sessions/s-1/attendance')
        .set('x-test-role', 'tutor')
        .send({ status: 'Completed' });
      expect(other.status).toBe(403);
      Model.get.mockResolvedValue(undefined);
      const missing = await request(server())
        .put('/sessions/s-404/attendance')
        .set('x-test-role', 'admin')
        .send({ status: 'Completed' });
      expect(missing.status).toBe(404);
    });
  });
});
