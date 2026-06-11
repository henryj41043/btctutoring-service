import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_CLIENT_SECRET = 'test-client-secret';
process.env.COGNITO_USER_POOL_ID = 'test-pool-id';

import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { bootIntegrationApp } from './helpers';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Auth (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [AuthController],
      providers: [AuthService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => cognitoMock.reset());

  const server = () => app.getHttpServer();

  it('public login returns the Cognito authentication result', async () => {
    cognitoMock
      .on(InitiateAuthCommand)
      .resolves({ AuthenticationResult: { AccessToken: 'access-token' } });

    const res = await request(server())
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'Pass1!' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ AccessToken: 'access-token' });
  });

  it('public signup delegates to Cognito', async () => {
    cognitoMock.on(SignUpCommand).resolves({});
    const res = await request(server())
      .post('/auth/signup')
      .send({ email: 'a@b.com', password: 'Pass1!' });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/Signup successful/);
  });

  it('admin can create a user', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({ User: { Username: 'a@b.com' } });
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});

    const res = await request(server())
      .post('/auth/user')
      .set('x-test-role', 'admin')
      .send({ email: 'a@b.com', group: 'Tutors', id: 'contact-1' });

    expect(res.status).toBe(201);
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(1);
  });

  it('a tutor cannot create a user', async () => {
    const res = await request(server())
      .post('/auth/user')
      .set('x-test-role', 'tutor')
      .send({ email: 'a@b.com', group: 'Tutors', id: 'contact-1' });
    expect(res.status).toBe(403);
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  it('admin can delete another user but not themselves', async () => {
    cognitoMock.on(AdminDeleteUserCommand).resolves({});

    const other = await request(server())
      .delete('/auth/user/someone@b.com')
      .set('x-test-role', 'admin');
    expect(other.status).toBe(200);

    const self = await request(server())
      .delete('/auth/user/admin@example.com')
      .set('x-test-role', 'admin');
    expect(self.status).toBe(403);
  });
});
