import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionsController } from '../../src/sessions/sessions.controller';
import { SessionsService } from '../../src/sessions/sessions.service';
import { SessionsModel } from '../../src/models/sessions.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/sessions.model', () => ({
  SessionsModel: require('../model-mock').makeModelMock(),
}));

const Model = SessionsModel as unknown as ModelMock;

describe('Sessions (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [SessionsController],
      providers: [SessionsService],
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
      .get('/sessions?tutor=tutor@example.com')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(200);
    expect(Model.scan).toHaveBeenCalledWith({
      tutor_id: { eq: 'tutor@example.com' },
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
      .send({ id: 's-1', tutor_id: 'tutor@example.com' });
    expect(ok.status).toBe(200);

    const denied = await request(server())
      .put('/sessions')
      .set('x-test-role', 'tutor')
      .send({ id: 's-2', tutor_id: 'other@example.com' });
    expect(denied.status).toBe(403);
  });
});
