import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Session } from '../models/session.model';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getSessions(
    @Request() req: express.Request,
    @Query('tutor') tutor: string,
    @Query('student') student: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    const isTutor: boolean = user.groups.includes('Tutors');
    const idMatchesTutor: boolean = tutor === user.email;
    if (tutor && student) {
      if (isAdmin || (isTutor && idMatchesTutor)) {
        return this.sessionsService.getSessions(tutor, student);
      }
    } else if (tutor) {
      if (isAdmin || (isTutor && idMatchesTutor)) {
        return this.sessionsService.getSessionsByTutor(tutor);
      }
    } else if (student) {
      if (isAdmin) {
        return this.sessionsService.getSessionsByStudent(student);
      }
    } else {
      if (isAdmin) {
        return this.sessionsService.getAllSessions();
      }
    }
    Logger.error('Invalid parameters for given user credentials');
    return Promise.reject(new Error('Unauthorized'));
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createSession(
    @Request() req: express.Request,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.sessionsService.createSession(session);
    } else {
      Logger.error('Creating new session is restricted to admins');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateSession(
    @Request() req: express.Request,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    const isTutor: boolean = user.groups.includes('Tutors');
    const idMatchesTutor: boolean = session.tutor_id === user.email;
    if (isAdmin || (isTutor && idMatchesTutor)) {
      return this.sessionsService.updateSession(session);
    } else {
      Logger.error('Invalid credentials for the session being edited');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteSession(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.sessionsService.deleteSession(id);
    } else {
      Logger.error('Deleting a session is restricted to admins');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
