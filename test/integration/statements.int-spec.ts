import { INestApplication } from '@nestjs/common';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import request from 'supertest';
import { StatementController } from '../../src/billing/statement.controller';
import { StatementService } from '../../src/billing/statement.service';
import { BillingService } from '../../src/billing/billing.service';
import { StudentsService } from '../../src/students/students.service';
import { ContactsService } from '../../src/contacts/contacts.service';
import { PackagesService } from '../../src/packages/packages.service';
import { StudentsModel } from '../../src/models/students.model';
import { ContactsModel } from '../../src/models/contacts.model';
import { BillingModel } from '../../src/models/billing.model';
import { PackagesModel } from '../../src/models/packages.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/students.model', () => ({
  StudentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/billing.model', () => ({
  BillingModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/packages.model', () => ({
  PackagesModel: require('../model-mock').makeModelMock(),
}));

const Students = StudentsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;
const Billing = BillingModel as unknown as ModelMock;
const Packages = PackagesModel as unknown as ModelMock;

const pat = {
  id: 's-1',
  contact_id: 'c-1',
  name: 'Pat',
  status: 'Active Student',
  package: 'Start',
  package_start_date: '2026-09-14T00:00:00',
  schedule: [{ weekday: 'MONDAY', start_time: '10:00', end_time: '10:45' }],
};

describe('Billing statements (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [StatementController],
      providers: [
        StatementService,
        BillingService,
        StudentsService,
        ContactsService,
        PackagesService,
        {
          provide: DynamoDBDocumentClient,
          useValue: { send: jest.fn().mockResolvedValue({ Items: [] }) },
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    scanResolves(Students, [pat]);
    scanResolves(Contacts, [
      { id: 'c-1', first_name: 'Robin', last_name: 'Reed' },
    ]);
    scanResolves(Packages, [
      {
        id: 'Start',
        monthlyCost: 273,
        sessionsPerWeek: 1,
        sessionLengthMin: 45,
      },
    ]);
  });

  const server = () => app.getHttpServer();

  it('admin reads a month (controller -> service -> engine)', async () => {
    const chain = scanResolves(Billing, [
      { contact_id: 'c-1', period_start: '2026-09-01', paid: true },
    ]);

    const res = await request(server())
      .get('/billing/statements?month=2026-09')
      .set('x-test-role', 'admin');

    expect(res.status).toBe(200);
    expect(chain.beginsWith).toHaveBeenCalledWith('2026-09');
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual(
      expect.objectContaining({
        contact_name: 'Robin Reed',
        total: 189,
        flags: ['prorated_start'],
      }),
    );
    expect(res.body[0].lines[0]).toEqual(
      expect.objectContaining({ sessions_billed: 3, sessions_in_month: 4 }),
    );
    expect(res.body[0].dues[0].paid).toBe(true);
  });

  it('rejects a malformed month', async () => {
    const res = await request(server())
      .get('/billing/statements?month=2026-9')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(400);
  });

  it('admin previews an unsaved student change', async () => {
    scanResolves(Billing, []);
    const res = await request(server())
      .post('/billing/statements/preview')
      .set('x-test-role', 'admin')
      .send({
        month: '2026-09',
        student: { ...pat, service_end_date: '2026-09-22' },
      });

    expect(res.status).toBe(200);
    expect(res.body.statement.total).toBe(126);
    expect(res.body.statement.flags).toEqual([
      'prorated_start',
      'prorated_end',
    ]);
    expect(Students.__save).not.toHaveBeenCalled();
  });

  it('tutor is forbidden', async () => {
    const read = await request(server())
      .get('/billing/statements?month=2026-09')
      .set('x-test-role', 'tutor');
    expect(read.status).toBe(403);
    const preview = await request(server())
      .post('/billing/statements/preview')
      .set('x-test-role', 'tutor')
      .send({ month: '2026-09', student: pat });
    expect(preview.status).toBe(403);
    expect(Students.scan).not.toHaveBeenCalled();
  });
});
