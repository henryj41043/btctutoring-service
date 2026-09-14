import { INestApplication } from '@nestjs/common';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import request from 'supertest';
import { SessionHorizonController } from '../../src/billing/session-horizon.controller';
import { SessionHorizonService } from '../../src/billing/session-horizon.service';
import { BillingService } from '../../src/billing/billing.service';
import { StudentsService } from '../../src/students/students.service';
import { SessionsService } from '../../src/sessions/sessions.service';
import { ContactsService } from '../../src/contacts/contacts.service';
import { StudentsModel } from '../../src/models/students.model';
import { SessionsModel } from '../../src/models/sessions.model';
import { ContactsModel } from '../../src/models/contacts.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/students.model', () => ({
  StudentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/sessions.model', () => ({
  SessionsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/billing.model', () => ({
  BillingModel: require('../model-mock').makeModelMock(),
}));

const Students = StudentsModel as unknown as ModelMock;
const Sessions = SessionsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;

const activeStudent = {
  id: 's-1',
  contact_id: 'c-1',
  name: 'Pat',
  status: 'Active Student',
  assigned_tutor_id: 't-1',
  package: 'Succeed',
  auto_renew: true,
  package_start_date: '2026-05-01T00:00:00',
  schedule: [{ weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' }],
};

describe('Session horizon fill (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [SessionHorizonController],
      providers: [
        SessionHorizonService,
        BillingService,
        StudentsService,
        SessionsService,
        ContactsService,
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
    Sessions.batchPut.mockResolvedValue(undefined);
  });

  const server = () => app.getHttpServer();

  it('admin fills every eligible student (controller -> service -> models)', async () => {
    scanResolves(Students, [activeStudent]);
    scanResolves(Contacts, [{ id: 't-1', first_name: 'Tess' }]);
    scanResolves(Sessions, []);

    const res = await request(server())
      .post('/sessions/horizon/fill')
      .set('x-test-role', 'admin');

    expect(res.status).toBe(201);
    expect(res.body.studentsFilled).toBe(1);
    expect(res.body.sessionsCreated).toBeGreaterThan(0);
    expect(res.body.lockedOut).toBe(false);
    expect(Sessions.batchPut).toHaveBeenCalled();
  });

  it('admin fills a single student via ?student=', async () => {
    Students.get.mockResolvedValue(activeStudent);
    scanResolves(Contacts, [{ id: 't-1', first_name: 'Tess' }]);
    const chain = scanResolves(Sessions, []);

    const res = await request(server())
      .post('/sessions/horizon/fill?student=s-1')
      .set('x-test-role', 'admin');

    expect(res.status).toBe(201);
    expect(Students.get).toHaveBeenCalledWith('s-1');
    expect(Sessions.scan).toHaveBeenCalledWith({ student_id: { eq: 's-1' } });
    expect(chain.between).toHaveBeenCalled();
    expect(res.body.studentsFilled).toBe(1);
  });

  it('tutor is forbidden', async () => {
    const res = await request(server())
      .post('/sessions/horizon/fill')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(403);
    expect(Sessions.batchPut).not.toHaveBeenCalled();
  });
});
