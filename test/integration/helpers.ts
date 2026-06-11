import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { Test } from '@nestjs/testing';
import { User } from '../../src/models/user.model';

export const ADMIN_USER: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'contact-admin',
};

export const TUTOR_USER: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'contact-tutor',
};

export const STRANGER_USER: User = {
  username: 'stranger',
  email: 'stranger@example.com',
  groups: [],
  contact: 'contact-stranger',
};

/**
 * Stand-in for the real Cognito JWT guard. It reads an `x-test-role` header and
 * attaches the matching test user, so a single booted app can exercise the
 * controllers' admin / tutor / stranger authorization branches over HTTP.
 */
export const testAuthGuard = {
  canActivate: (context: ExecutionContext): boolean => {
    const req = context.switchToHttp().getRequest();
    switch (req.headers['x-test-role']) {
      case 'tutor':
        req.user = TUTOR_USER;
        break;
      case 'none':
        req.user = STRANGER_USER;
        break;
      default:
        req.user = ADMIN_USER;
    }
    return true;
  },
};

/**
 * Boot a minimal Nest application for a feature module's controller + real
 * service, with the JWT guard replaced by the header-driven test guard and the
 * production global ValidationPipe applied. Only the data/AWS boundary should be
 * mocked by the caller (via `jest.mock` on the model module).
 */
export async function bootIntegrationApp(
  metadata: ModuleMetadata,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule(metadata)
    .overrideGuard(AuthGuard('jwt'))
    .useValue(testAuthGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.init();
  return app;
}
