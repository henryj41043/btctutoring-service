import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESClient } from '@aws-sdk/client-ses';

// Cognito/JWT strategy + auth service read these at construction time.
process.env.AWS_REGION = 'us-east-1';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_CLIENT_SECRET = 'test-client-secret';
// Must match Cognito's `<region>_<alphanumeric>` format — the JWT verifier
// validates it at construction even though the guard is overridden in tests.
process.env.COGNITO_USER_POOL_ID = 'us-east-1_aBcD12345';

// Replace the dynamoose model singletons with in-memory mocks so nothing
// touches DynamoDB. Each factory returns an independent mock.
jest.mock('../src/models/contacts.model', () => ({
  ContactsModel: require('./model-mock').makeModelMock(),
}));
jest.mock('../src/models/sessions.model', () => ({
  SessionsModel: require('./model-mock').makeModelMock(),
}));
jest.mock('../src/models/students.model', () => ({
  StudentsModel: require('./model-mock').makeModelMock(),
}));
jest.mock('../src/models/notes.model', () => ({
  NotesModel: require('./model-mock').makeModelMock(),
}));

import { AppModule } from '../src/app.module';
import { ContactsModel } from '../src/models/contacts.model';
import { SessionsModel } from '../src/models/sessions.model';
import { ModelMock, scanResolves } from './model-mock';
import { testAuthGuard } from './integration/helpers';

const Contacts = ContactsModel as unknown as ModelMock;
const Sessions = SessionsModel as unknown as ModelMock;

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const sesMock = mockClient(SESClient);

describe('btctutoring-service (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(testAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    cognitoMock.reset();
    sesMock.reset();
  });

  const server = () => app.getHttpServer();

  it('GET / returns the health string', async () => {
    await request(server()).get('/').expect(200).expect('Hello World!');
  });

  describe('auth flow', () => {
    it('logs a user in via Cognito', async () => {
      cognitoMock
        .on(InitiateAuthCommand)
        .resolves({ AuthenticationResult: { AccessToken: 'tok' } });

      const res = await request(server())
        .post('/auth/login')
        .send({ email: 'a@b.com', password: 'Pass1!' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ AccessToken: 'tok' });
    });
  });

  describe('contacts authorization', () => {
    it('admin can list contacts end-to-end', async () => {
      scanResolves(Contacts, [{ id: 'c-1', first_name: 'Ada' }]);
      const res = await request(server())
        .get('/contacts')
        .set('x-test-role', 'admin');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'c-1', first_name: 'Ada' }]);
    });

    it('a tutor cannot list every contact', async () => {
      const res = await request(server())
        .get('/contacts')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(403);
    });
  });

  describe('sessions authorization', () => {
    it('admin reads all sessions', async () => {
      scanResolves(Sessions, [{ id: 's-1' }]);
      const res = await request(server())
        .get('/sessions')
        .set('x-test-role', 'admin');
      expect(res.status).toBe(200);
    });

    it('a stranger cannot read sessions', async () => {
      const res = await request(server())
        .get('/sessions')
        .set('x-test-role', 'none');
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects a malformed contact payload with 400', async () => {
      const res = await request(server())
        .post('/contacts')
        .set('x-test-role', 'admin')
        .send({
          first_name: 'Bad',
          availability: [{ days: 'nope', start_time: 1, end_time: 2 }],
        });
      expect(res.status).toBe(400);
    });
  });
});
