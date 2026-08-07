import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionsController } from '../../src/sessions/sessions.controller';
import { SessionsService } from '../../src/sessions/sessions.service';
import { TeamsService } from '../../src/teams/teams.service';
import { SessionsModel } from '../../src/models/sessions.model';
import { TeamsModel } from '../../src/models/teams.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/sessions.model', () => ({
  SessionsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/teams.model', () => ({
  TeamsModel: require('../model-mock').makeModelMock(),
}));

const Model = SessionsModel as unknown as ModelMock;
const TeamModel = TeamsModel as unknown as ModelMock;

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

  it('a tutor may update their own session but not others', async () => {
    Model.update.mockResolvedValue({ id: 's-1' });
    const ok = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-1', tutor_id: 'contact-tutor' });
    expect(ok.status).toBe(200);

    const denied = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-2', tutor_id: 'other@example.com' });
    expect(denied.status).toBe(403);
  });

  it('a lead with a team gets the whole team sessions on the parameterless GET', async () => {
    TeamModel.scan.mockClear();
    scanResolves(TeamModel, [
      {
        id: 'team-1',
        name: 'Team A',
        lead_contact_id: 'contact-lead',
        member_contact_ids: ['contact-tutor'],
      },
    ]);
    const chain = scanResolves(Model, [{ id: 's-1' }]);
    const res = await request(server())
      .get('/sessions')
      .set('x-test-role', 'lead');
    expect(res.status).toBe(200);
    expect(TeamModel.scan).toHaveBeenCalledWith({
      lead_contact_id: { eq: 'contact-lead' },
    });
    expect(chain.where).toHaveBeenCalledWith('tutor_id');
    expect(chain.in).toHaveBeenCalledWith(['contact-lead', 'contact-tutor']);
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

  it('a lead may update their own session but not a member session', async () => {
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
});
