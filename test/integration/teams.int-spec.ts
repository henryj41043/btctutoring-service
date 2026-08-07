import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TeamsController } from '../../src/teams/teams.controller';
import { TeamsService } from '../../src/teams/teams.service';
import { TeamsModel } from '../../src/models/teams.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/teams.model', () => ({
  TeamsModel: require('../model-mock').makeModelMock(),
}));

const Model = TeamsModel as unknown as ModelMock;

describe('Teams (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [TeamsController],
      providers: [TeamsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('admin lists teams', async () => {
    scanResolves(Model, [{ id: 'team-1', name: 'Team A' }]);
    const res = await request(server()).get('/teams').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'team-1', name: 'Team A' }]);
  });

  it('admin creates a team', async () => {
    scanResolves(Model, []); // no existing teams -> validation passes
    Model.__save.mockResolvedValue(undefined);
    const res = await request(server())
      .post('/teams')
      .set('x-test-role', 'admin')
      .send({
        name: 'Team A',
        lead_contact_id: 'contact-lead',
        member_contact_ids: ['contact-tutor'],
      });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Team created successfully.');
  });

  it('rejects double-assignment with a 400 naming the contact', async () => {
    scanResolves(Model, [
      {
        id: 'other-team',
        name: 'Team B',
        lead_contact_id: 'contact-other',
        member_contact_ids: ['contact-tutor'],
      },
    ]);
    const res = await request(server())
      .post('/teams')
      .set('x-test-role', 'admin')
      .send({
        name: 'Team A',
        lead_contact_id: 'contact-lead',
        member_contact_ids: ['contact-tutor'],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Contact(s) already assigned to another team: contact-tutor',
    );
  });

  it('admin deletes a team', async () => {
    Model.delete.mockResolvedValue(undefined);
    const res = await request(server())
      .delete('/teams/team-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(Model.delete).toHaveBeenCalledWith({ id: 'team-1' });
  });

  it.each(['tutor', 'lead', 'none'])(
    'a %s user is rejected on every route',
    async (role) => {
      const list = await request(server()).get('/teams').set('x-test-role', role);
      expect(list.status).toBe(403);
      const create = await request(server())
        .post('/teams')
        .set('x-test-role', role)
        .send({ name: 'X', lead_contact_id: 'c', member_contact_ids: [] });
      expect(create.status).toBe(403);
      const update = await request(server())
        .put('/teams')
        .set('x-test-role', role)
        .send({ id: 'team-1', name: 'X', lead_contact_id: 'c', member_contact_ids: [] });
      expect(update.status).toBe(403);
      const del = await request(server())
        .delete('/teams/team-1')
        .set('x-test-role', role);
      expect(del.status).toBe(403);
    },
  );
});
