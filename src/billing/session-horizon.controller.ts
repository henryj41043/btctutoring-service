import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import {
  HorizonFillResult,
  SessionHorizonService,
} from './session-horizon.service';

/**
 * Admin trigger for the session horizon fill: the app calls it (with
 * `?student=`) right after a schedule save so the next three months appear
 * immediately, and support can run it without a student to backfill or
 * spot-check. With `&from=YYYY-MM-DD` it REBUILDS that student's sessions
 * from the date (after the app removed the pending ones of a scheduled
 * change that was removed or re-dated). Runs WITHOUT the daily lock.
 */
@Controller('sessions/horizon')
export class SessionHorizonController {
  constructor(private readonly horizon: SessionHorizonService) {}

  @Post('fill')
  @UseGuards(AuthGuard('jwt'))
  async fill(
    @Request() req: express.Request,
    @Query('student') student?: string,
    @Query('from') from?: string,
  ): Promise<HorizonFillResult> {
    const user: User = req.user as User;
    if (!(user.groups ?? []).includes('Admins')) {
      Logger.error('Session horizon fill is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
    if (from) {
      // Rebuild mode: one student, from a real date.
      if (!student) {
        throw new BadRequestException('from requires a student.');
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        isNaN(Date.parse(`${from}T00:00:00Z`))
      ) {
        throw new BadRequestException('from must be formatted YYYY-MM-DD.');
      }
    }
    return this.horizon.fillHorizon(new Date(), {
      lock: false,
      studentId: student || undefined,
      ...(from ? { rebuildFrom: from } : {}),
    });
  }
}
