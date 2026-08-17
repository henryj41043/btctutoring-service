import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import express from 'express';

/**
 * One log line per request — `GET /sessions 200 143ms` — so slow endpoints can
 * be ranked straight from CloudWatch Logs Insights.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Timing');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const request = context.switchToHttp().getRequest<express.Request>();
    const response = context.switchToHttp().getResponse<express.Response>();
    return next.handle().pipe(
      tap({
        next: () => this.log(request, response.statusCode, started),
        error: (error: { status?: number }) =>
          this.log(request, error.status ?? 500, started),
      }),
    );
  }

  private log(request: express.Request, status: number, started: number): void {
    this.logger.log(
      `${request.method} ${request.url} ${status} ${Date.now() - started}ms`,
    );
  }
}
