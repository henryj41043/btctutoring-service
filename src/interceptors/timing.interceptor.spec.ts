import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { TimingInterceptor } from './timing.interceptor';

describe('TimingInterceptor', () => {
  let interceptor: TimingInterceptor;
  let logSpy: jest.SpyInstance;

  const makeContext = (statusCode: number): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', url: '/sessions?from=a' }),
        getResponse: () => ({ statusCode }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    interceptor = new TimingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    // Deterministic duration: start reads 1000, finish reads 1145 → 145ms.
    jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValue(1145);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs method, url, status and duration on success', (done) => {
    const next: CallHandler = { handle: () => of('body') };

    interceptor.intercept(makeContext(200), next).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledWith('GET /sessions?from=a 200 145ms');
        done();
      },
    });
  });

  it('logs the error status when the handler errors', (done) => {
    const next: CallHandler = {
      handle: () => throwError(() => ({ status: 403 })),
    };

    interceptor.intercept(makeContext(200), next).subscribe({
      error: () => {
        expect(logSpy).toHaveBeenCalledWith('GET /sessions?from=a 403 145ms');
        done();
      },
    });
  });

  it('falls back to 500 for errors without a status', (done) => {
    const next: CallHandler = {
      handle: () => throwError(() => ({})),
    };

    interceptor.intercept(makeContext(200), next).subscribe({
      error: () => {
        expect(logSpy).toHaveBeenCalledWith('GET /sessions?from=a 500 145ms');
        done();
      },
    });
  });
});
