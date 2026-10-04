import {
  BadRequestException,
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
import {
  AttendanceRequest,
  AttendanceResult,
  ScheduledMakeup,
  SessionsService,
  SessionRange,
} from './sessions.service';
import {
  ATTENDANCE_FINAL_MESSAGE,
  isFinalized,
  lockedFieldChanges,
} from './attendance';
import { TeamsService } from '../teams/teams.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Session, SessionType } from '../models/session.model';
import { isLeadTutor, isTutorLike } from '../models/user-groups';

export const ATTENDANCE_ROUTE_MESSAGE =
  'Take attendance with PUT /sessions/:id/attendance.';

export const SESSION_TYPE_LOCKED_MESSAGE =
  'Only an admin can change the session type.';

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
        // sessions — transitively, since a member who leads a team of their
        // own brings that team along (nested teams). Resolved server-side so
        // the client never asserts membership. The lead is included via
        // user.contact (not the record's lead id) so a mis-pointed team can't
        // widen access.
        const members = await this.teamsService.resolveTeamTutorIds(
          user.contact,
        );
        if (members.length === 0) {
          // No team (or an empty one) — degrade to plain-tutor behavior.
          return this.sessionsService.getSessionsByTutor(user.contact, range);
        }
        const ids = [...new Set([user.contact, ...members])];
        return this.sessionsService.getSessionsByTutors(ids, range);
      }
    }
    Logger.error('Invalid parameters for given user credentials');
    throw new ForbiddenException('Unauthorized');
  }

  /**
   * Scheduled (pending) make-up minutes per student. An admin gets every
   * student; a tutor or lead tutor gets their own students, counted across
   * all tutors, so the number left to schedule is right whoever booked them.
   */
  @Get('makeup-scheduled')
  @UseGuards(AuthGuard('jwt'))
  async getScheduledMakeup(
    @Request() req: express.Request,
  ): Promise<ScheduledMakeup[]> {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    if (groups.includes('Admins')) {
      return this.sessionsService.getScheduledMakeupMinutes();
    }
    if (isTutorLike(groups) && user.contact) {
      return this.sessionsService.getScheduledMakeupMinutes(user.contact);
    }
    Logger.error('User not authorized to read scheduled make-up minutes');
    throw new ForbiddenException('Unauthorized');
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createSession(
    @Request() req: express.Request,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    const isAdmin: boolean = groups.includes('Admins');
    if (isAdmin) {
      return this.sessionsService.createSession(session);
    }
    // Tutors schedule their OWN make-ups (client policy 2026-08): a non-admin
    // may create a session only when it's a MAKE_UP assigned to themselves.
    // Unlike updates there's no stored record to cross-check — the payload
    // constraint IS the whole authz surface, so both fields are pinned.
    const isOwnMakeup: boolean =
      session.type === SessionType.MAKE_UP &&
      !!session.tutor_id &&
      session.tutor_id === user.contact;
    if (isTutorLike(groups) && isOwnMakeup) {
      return this.sessionsService.createSession(session);
    }
    Logger.error('Creating new session is restricted to admins');
    throw new ForbiddenException('Unauthorized');
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
    // Leads may edit their OWN sessions like any tutor — team visibility is
    // read-only, so members' sessions never pass the ownership checks below.
    // Sessions store tutor_id = the tutor's contact id (not their email).
    // The payload check alone is not enough: the update is keyed by the
    // body's id, so ownership must be verified against the STORED session —
    // otherwise any tutor could overwrite any session id by claiming their
    // own tutor_id in the payload.
    const idMatchesTutor: boolean =
      !!session.tutor_id && session.tutor_id === user.contact;
    const mayOwn: boolean =
      isTutorLike(groups) && idMatchesTutor && !!session.id;
    if (!isAdmin && !mayOwn) {
      Logger.error('Invalid credentials for the session being edited');
      throw new ForbiddenException('Unauthorized');
    }
    // The attendance lock needs the STORED session, whoever is calling.
    const stored = session.id
      ? await this.sessionsService.getSessionById(session.id)
      : undefined;
    if (!isAdmin && (!stored || stored.tutor_id !== user.contact)) {
      Logger.error('Invalid credentials for the session being edited');
      throw new ForbiddenException('Unauthorized');
    }
    if (stored && isFinalized(stored.status)) {
      const locked = lockedFieldChanges(stored, session);
      // A status change here would skip the make-up minute correction.
      if (locked.includes('status')) {
        if (!isAdmin) {
          throw new ForbiddenException(ATTENDANCE_FINAL_MESSAGE);
        }
        throw new BadRequestException(
          'Attendance was already taken: change it with PUT /sessions/:id/attendance.',
        );
      }
      if (!isAdmin && locked.length > 0) {
        Logger.error(
          `Finalized session ${session.id}: refused a change to ${locked.join(', ')}`,
        );
        throw new ForbiddenException(ATTENDANCE_FINAL_MESSAGE);
      }
    }
    // Taking attendance moves make-up minutes and is recorded, so it only
    // happens through the attendance route: the ordinary update never turns
    // a pending session into a finalized one, whoever asks.
    if (stored && !isFinalized(stored.status) && isFinalized(session.status)) {
      Logger.error(
        `Session ${session.id}: refused attendance through the ordinary update`,
      );
      throw new BadRequestException(ATTENDANCE_ROUTE_MESSAGE);
    }
    // The type decides how a session is paid and whether a cancellation
    // banks make-up minutes, so only an admin may change it. Sessions stored
    // before types existed count as tutoring, as they do everywhere else.
    if (
      !isAdmin &&
      stored &&
      session.type !== undefined &&
      session.type !== (stored.type ?? SessionType.TUTORING)
    ) {
      Logger.error(
        `Session ${session.id}: refused a type change by a non-admin`,
      );
      throw new ForbiddenException(SESSION_TYPE_LOCKED_MESSAGE);
    }
    return this.sessionsService.updateSession(session);
  }

  /**
   * Takes or corrects attendance (see SessionsService.setAttendance). With
   * `?dry_run=true` nothing is written: the result is the preview shown
   * before an admin confirms a correction.
   */
  @Put(':id/attendance')
  @UseGuards(AuthGuard('jwt'))
  async setAttendance(
    @Request() req: express.Request,
    @Param('id') id: string,
    @Body() request: AttendanceRequest,
    @Query('dry_run') dryRun?: string,
  ): Promise<AttendanceResult> {
    return this.sessionsService.setAttendance(id, request, req.user as User, {
      dryRun: dryRun === 'true',
    });
  }

  @Post(':id/email-notes')
  @UseGuards(AuthGuard('jwt'))
  async emailSessionNotes(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    const isAdmin: boolean = groups.includes('Admins');
    if (isAdmin) {
      return this.sessionsService.emailSessionNotes(id);
    }
    // A tutor may email the notes of their OWN sessions only — ownership is
    // checked against the STORED session (updateSession precedent).
    if (isTutorLike(groups)) {
      const stored = await this.sessionsService.getSessionById(id);
      if (stored && stored.tutor_id === user.contact) {
        return this.sessionsService.emailSessionNotes(id);
      }
    }
    Logger.error('Invalid credentials for emailing session notes');
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
