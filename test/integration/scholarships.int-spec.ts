import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ScholarshipsController } from '../../src/scholarships/scholarships.controller';
import { ScholarshipsService } from '../../src/scholarships/scholarships.service';
import { ScholarshipsModel } from '../../src/models/scholarships.model';
import { ModelMock } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/scholarships.model', () => ({
  ScholarshipsModel: require('../model-mock').makeModelMock(),
}));

const Model = ScholarshipsModel as unknown as ModelMock;

describe('Scholarships (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [ScholarshipsController],
      providers: [ScholarshipsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Model.__save.mockResolvedValue(undefined);
  });

  const server = () => app.getHttpServer();
  const saved = (): Record<string, unknown> =>
    (Model as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;

  // Regression (client 2026-09-27): dates arrive as ISO strings over HTTP and
  // must reach the model as real Dates — dynamoose rejects strings.
  it('saves a record whose dates arrive as ISO strings', async () => {
    const res = await request(server())
      .post('/scholarships')
      .set('x-test-role', 'admin')
      .send({
        contact_id: 'c-1',
        month: '2026-09',
        scholarship_state: 'Invoice Paid',
        invoice_number: 'INV-7',
        date_funds_requested_by_btc: '2026-09-02T04:00:00.000Z',
        date_funds_requested_by_family: '2026-09-05T04:00:00.000Z',
        invoice_paid_date: '2026-09-15T04:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('c-1#2026-09');
    const attrs = saved();
    expect(attrs.invoice_paid_date).toBeInstanceOf(Date);
    expect((attrs.invoice_paid_date as Date).toISOString()).toBe(
      '2026-09-15T04:00:00.000Z',
    );
    expect(attrs.date_funds_requested_by_btc).toBeInstanceOf(Date);
    expect(attrs.date_funds_requested_by_family).toBeInstanceOf(Date);
    expect(Model.__save).toHaveBeenCalledTimes(1);
  });

  it('drops null dates (cleared fields) instead of failing', async () => {
    const res = await request(server())
      .post('/scholarships')
      .set('x-test-role', 'admin')
      .send({
        contact_id: 'c-1',
        month: '2026-09',
        invoice_number: 'INV-7',
        date_funds_requested_by_btc: null,
        invoice_paid_date: null,
      });

    expect(res.status).toBe(201);
    const attrs = saved();
    expect('invoice_paid_date' in attrs).toBe(false);
    expect('date_funds_requested_by_btc' in attrs).toBe(false);
    expect(attrs.invoice_number).toBe('INV-7');
  });

  it('rejects an unparseable date with 400 and saves nothing', async () => {
    const res = await request(server())
      .post('/scholarships')
      .set('x-test-role', 'admin')
      .send({
        contact_id: 'c-1',
        month: '2026-09',
        invoice_paid_date: 'not-a-date',
      });

    expect(res.status).toBe(400);
    expect(Model.__save).not.toHaveBeenCalled();
  });

  it('tutor is forbidden', async () => {
    const res = await request(server())
      .post('/scholarships')
      .set('x-test-role', 'tutor')
      .send({ contact_id: 'c-1', month: '2026-09' });
    expect(res.status).toBe(403);
    expect(Model.__save).not.toHaveBeenCalled();
  });
});
