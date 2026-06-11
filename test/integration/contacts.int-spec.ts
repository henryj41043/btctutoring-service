import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ContactsController } from '../../src/contacts/contacts.controller';
import { ContactsService } from '../../src/contacts/contacts.service';
import { ContactsModel } from '../../src/models/contacts.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));

const Model = ContactsModel as unknown as ModelMock;

describe('Contacts (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [ContactsController],
      providers: [ContactsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('admin lists all contacts (controller -> service -> model)', async () => {
    scanResolves(Model, [{ id: 'c-1', first_name: 'Ada' }]);

    const res = await request(server())
      .get('/contacts')
      .set('x-test-role', 'admin');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'c-1', first_name: 'Ada' }]);
    expect(Model.scan).toHaveBeenCalledWith();
  });

  it('admin fetches a single contact by id', async () => {
    scanResolves(Model, [{ id: 'c-1' }]);
    const res = await request(server())
      .get('/contacts?id=c-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(Model.scan).toHaveBeenCalledWith({ id: { eq: 'c-1' } });
  });

  it('tutor may fetch their own contact', async () => {
    scanResolves(Model, [{ id: 'contact-tutor' }]);
    const res = await request(server())
      .get('/contacts?id=contact-tutor')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(200);
  });

  it('tutor requesting another contact is rejected by the controller', async () => {
    const res = await request(server())
      .get('/contacts?id=someone-else')
      .set('x-test-role', 'tutor');
    // The controller throws ForbiddenException -> 403.
    expect(res.status).toBe(403);
    expect(Model.scan).not.toHaveBeenCalled();
  });

  it('admin creates a contact', async () => {
    Model.__save.mockResolvedValue(undefined);
    const res = await request(server())
      .post('/contacts')
      .set('x-test-role', 'admin')
      .send({
        first_name: 'Grace',
        last_name: 'Hopper',
        email: 'grace@example.com',
        phone_number: '5550000000',
        service: 'Tutoring',
      });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Contact created successfully.');
  });

  it('non-admin cannot create a contact', async () => {
    const res = await request(server())
      .post('/contacts')
      .set('x-test-role', 'tutor')
      .send({
        first_name: 'X',
        last_name: 'Y',
        email: 'x@example.com',
        phone_number: '5551112222',
        service: 'Tutoring',
      });
    expect(res.status).toBe(403);
    expect(Model.__save).not.toHaveBeenCalled();
  });

  it('rejects a contact with an invalid availability block (ValidationPipe)', async () => {
    const res = await request(server())
      .post('/contacts')
      .set('x-test-role', 'admin')
      .send({
        first_name: 'Bad',
        last_name: 'Data',
        email: 'bad@example.com',
        phone_number: '5559998888',
        service: 'Tutoring',
        availability: [{ days: 'not-an-array', start_time: 1, end_time: 2 }],
      });
    expect(res.status).toBe(400);
  });

  it('admin deletes a contact', async () => {
    Model.delete.mockResolvedValue(undefined);
    const res = await request(server())
      .delete('/contacts/c-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(Model.delete).toHaveBeenCalledWith({ id: 'c-1' });
  });
});
