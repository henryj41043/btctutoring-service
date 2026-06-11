import { Logger } from '@nestjs/common';

// Silence framework logging so test output stays readable. The services log on
// every error branch; those branches are still asserted via their return values.
beforeAll(() => {
  jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
