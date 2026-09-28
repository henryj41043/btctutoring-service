import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EmailsController } from '../../src/emails/emails.controller';
import { EmailsService } from '../../src/emails/emails.service';
import { EmailsModel } from '../../src/models/emails.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/emails.model', () => ({
  EmailsModel: require('../model-mock').makeModelMock(),
}));

const Model = EmailsModel as unknown as ModelMock;

const conversation = {
  id: 'thread-1',
  status: 'matched',
  contact_id: 'c-1',
  subject: 'Schedule change',
  sent_at: '2026-08-04T13:12:00.000Z',
  body_text: 'first\n\nsecond',
  is_thread: true,
  message_count: 2,
  participants: [
    { email: 'jane@example.com', name: 'Jane Parent' },
    { email: 'admin@btc.test' },
  ],
};

describe('Emails (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [EmailsController],
      providers: [EmailsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();

  it("admin lists a contact's emails, conversation fields included", async () => {
    scanResolves(Model, [conversation]);
    const res = await request(server())
      .get('/emails/contact/c-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([conversation]);
    expect(Model.scan).toHaveBeenCalledWith({
      contact_id: { eq: 'c-1' },
      status: { eq: 'matched' },
    });
  });

  it('admin lists the unmatched queue', async () => {
    const unmatched = {
      ...conversation,
      status: 'unmatched',
      contact_id: undefined,
    };
    scanResolves(Model, [unmatched]);
    const res = await request(server())
      .get('/emails/unmatched')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body[0].participants).toEqual(conversation.participants);
    expect(Model.scan).toHaveBeenCalledWith({ status: { eq: 'unmatched' } });
  });

  it('admin assigns a conversation to a contact', async () => {
    Model.get.mockResolvedValue({ ...conversation, status: 'unmatched' });
    Model.update.mockResolvedValue(conversation);
    const res = await request(server())
      .post('/emails/thread-1/assign')
      .set('x-test-role', 'admin')
      .send({ contact_id: 'c-1' });
    expect(res.status).toBeLessThan(300);
    expect(Model.update).toHaveBeenCalledWith(
      { id: 'thread-1' },
      expect.objectContaining({ contact_id: 'c-1', status: 'matched' }),
    );
  });

  it('a tutor cannot read emails', async () => {
    const res = await request(server())
      .get('/emails/contact/c-1')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(403);
    expect(Model.scan).not.toHaveBeenCalled();
  });
});
