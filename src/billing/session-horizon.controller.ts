import {
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
 * spot-check. Runs WITHOUT the daily lock.
 */
@Controller('sessions/horizon')
export class SessionHorizonController {
  constructor(private readonly horizon: SessionHorizonService) {}

  @Post('fill')
  @UseGuards(AuthGuard('jwt'))
  async fill(
    @Request() req: express.Request,
    @Query('student') student?: string,
  ): Promise<HorizonFillResult> {
    const user: User = req.user as User;
    if (!(user.groups ?? []).includes('Admins')) {
      Logger.error('Session horizon fill is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
    return this.horizon.fillHorizon(new Date(), {
      lock: false,
      studentId: student || undefined,
    });
  }
}
