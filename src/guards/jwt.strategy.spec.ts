import express from 'express';
import type { JwtPayload } from 'aws-jwt-verify/jwt-model';

const mockVerify = jest.fn();

jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: mockVerify })) },
}));

jest.mock('jwks-rsa', () => ({
  passportJwtSecret: jest.fn(() => jest.fn()),
}));

process.env.AWS_REGION = 'us-east-1';
process.env.COGNITO_USER_POOL_ID = 'pool-1';
process.env.COGNITO_CLIENT_ID = 'client-1';

// Imported after the mocks + env are in place.
import { JwtStrategy } from './jwt.strategy';

const reqWithIdToken = (idToken?: string): express.Request =>
  ({ headers: idToken ? { 'x-id-token': idToken } : {} }) as unknown as express.Request;

const accessPayload = (overrides: Record<string, unknown> = {}): JwtPayload =>
  ({
    username: 'user-1',
    'cognito:groups': ['Admins'],
    ...overrides,
  }) as unknown as JwtPayload;

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    mockVerify.mockReset();
    strategy = new JwtStrategy();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  it('returns the mapped user when the id and access tokens match', async () => {
    mockVerify.mockResolvedValue({
      'cognito:username': 'user-1',
      email: 'user@example.com',
      'custom:contact_id': 'contact-1',
    });

    const user = await strategy.validate(reqWithIdToken('id-token'), accessPayload());

    expect(mockVerify).toHaveBeenCalledWith('id-token');
    expect(user).toEqual({
      username: 'user-1',
      groups: ['Admins'],
      email: 'user@example.com',
      contact: 'contact-1',
    });
  });

  it('throws when the id token username does not match the access token', async () => {
    mockVerify.mockResolvedValue({ 'cognito:username': 'someone-else' });

    await expect(
      strategy.validate(reqWithIdToken('id-token'), accessPayload()),
    ).rejects.toThrow('Token Mismatch');
  });

  it('propagates verification failures', async () => {
    mockVerify.mockRejectedValue(new Error('invalid token'));

    await expect(
      strategy.validate(reqWithIdToken('id-token'), accessPayload()),
    ).rejects.toThrow('invalid token');
  });
});
