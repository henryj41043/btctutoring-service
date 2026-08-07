import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SessionsService, SessionRange } from './sessions.service';
import { TeamsService } from '../teams/teams.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Session } from '../models/session.model';
import { isLeadTutor, isTutorLike } from '../models/user-groups';

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly teamsService: TeamsService,
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getSessions(
    @Request() req: express.Request,
    @Query('tutor') tutor: string,
    @Query('student') student: string,
    @Query('series') series: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    const isAdmin: boolean = groups.includes('Admins');
    // Lead Tutors are tutors for self-access purposes; their extra power is
    // only the parameterless team read below.
    const tutorLike: boolean = isTutorLike(groups);
    // Sessions store tutor_id = the tutor's contact id (not their email).
    const idMatchesTutor: boolean = !!tutor && tutor === user.contact;
    // Optional start_datetime range; combinable with tutor/student filters.
    // Range params never change who may see what — the auth matrix is unchanged.
    const range: SessionRange | undefined =
      from || to ? { from: from || undefined, to: to || undefined } : undefined;
    if (series) {
      if (isAdmin) {
        return this.sessionsService.getSessionsBySeries(series);
      }
    } else if (tutor && student) {
      if (isAdmin || (tutorLike && idMatchesTutor)) {
        return this.sessionsService.getSessions(tutor, student, range);
      }
    } else if (tutor) {
      if (isAdmin || (tutorLike && idMatchesTutor)) {
        return this.sessionsService.getSessionsByTutor(tutor, range);
      }
    } else if (student) {
      if (isAdmin) {
        return this.sessionsService.getSessionsByStudent(student, range);
      }
    } else {
      if (isAdmin) {
        return this.sessionsService.getAllSessions(range);
      }
      if (isLeadTutor(groups)) {
        // Lead Tutors: the parameterless GET returns the whole team's
        // sessions. The team is resolved server-side so the client never
        // asserts membership. The lead is included via user.contact (not the
        // record's lead id) so a mis-pointed team can't widen access.
        const team = await this.teamsService.getTeamByLead(user.contact);
        if (!team) {
          // No team yet — degrade to plain-tutor behavior (own sessions).
          return this.sessionsService.getSessionsByTutor(user.contact, range);
        }
        const ids = [
          ...new Set([user.contact, ...(team.member_contact_ids ?? [])]),
        ];
        return this.sessionsService.getSessionsByTutors(ids, range);
      }
    }
    Logger.error('Invalid parameters for given user credentials');
    throw new ForbiddenException('Unauthorized');
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createSession(
    @Request() req: express.Request,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.sessionsService.createSession(session);
    } else {
      Logger.error('Creating new session is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post('batch')
  @UseGuards(AuthGuard('jwt'))
  async createSessions(
    @Request() req: express.Request,
    @Body() sessions: Session[],
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.sessionsService.createSessions(sessions);
    } else {
      Logger.error('Creating sessions is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateSession(
    @Request() req: express.Request,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    const isAdmin: boolean = groups.includes('Admins');
    if (isAdmin) {
      return this.sessionsService.updateSession(session);
    }
    // Leads may edit their OWN sessions like any tutor — team visibility is
    // read-only, so members' sessions never pass the ownership checks below.
    // Sessions store tutor_id = the tutor's contact id (not their email).
    // The payload check alone is not enough: the update is keyed by the
    // body's id, so ownership must be verified against the STORED session —
    // otherwise any tutor could overwrite any session id by claiming their
    // own tutor_id in the payload.
    const idMatchesTutor: boolean =
      !!session.tutor_id && session.tutor_id === user.contact;
    if (isTutorLike(groups) && idMatchesTutor && session.id) {
      const stored = await this.sessionsService.getSessionById(session.id);
      if (stored && stored.tutor_id === user.contact) {
        return this.sessionsService.updateSession(session);
      }
    }
    Logger.error('Invalid credentials for the session being edited');
    throw new ForbiddenException('Unauthorized');
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteSession(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.sessionsService.deleteSession(id);
    } else {
      Logger.error('Deleting a session is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
