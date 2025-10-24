import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
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
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { CognitoIdTokenPayload } from 'aws-jwt-verify/jwt-model';
import { Session } from '../models/session.model';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  private verifier = CognitoJwtVerifier.create({
    userPoolId: `${process.env.COGNITO_USER_POOL_ID}`,
    tokenUse: 'id',
    clientId: `${process.env.COGNITO_CLIENT_ID}`,
  });

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getSessions(
    @Request() req: express.Request,
    @Headers('X-ID-Token') idToken: string,
    @Query('tutor') tutor: string,
    @Query('student') student: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('admin');
    const isTutor: boolean = user.groups.includes('tutor');
    const idTokenPayload: CognitoIdTokenPayload =
      await this.verifier.verify(idToken);
    const idMatchesUsername: boolean =
      user.username === idTokenPayload['cognito:username'];
    const idMatchesTutor: boolean = tutor === idTokenPayload.email;
    if (!idMatchesUsername) {
      Logger.error('Access token and Id token do not match');
      return Promise.reject(new Error('Id mismatch'));
    }
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
    const isAdmin: boolean = user.groups.includes('admin');
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
    @Headers('X-ID-Token') idToken: string,
    @Body() session: Session,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('admin');
    const isTutor: boolean = user.groups.includes('tutor');
    const idTokenPayload: CognitoIdTokenPayload =
      await this.verifier.verify(idToken);
    const idMatchesUsername: boolean =
      user.username === idTokenPayload['cognito:username'];
    const idMatchesTutor: boolean = session.tutor === idTokenPayload.email;
    if (!idMatchesUsername) {
      Logger.error('Access token and Id token do not match');
      return Promise.reject(new Error('Id mismatch'));
    }
    if (isAdmin || (isTutor && idMatchesTutor)) {
      return this.sessionsService.updateSession(session);
    } else {
      Logger.error('Invalid credentials for the session being edited');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete()
  @UseGuards(AuthGuard('jwt'))
  async deleteSession(
    @Request() req: express.Request,
    @Query('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('admin');
    if (isAdmin) {
      return this.sessionsService.deleteSession(id);
    } else {
      Logger.error('Deleting a session is restricted to admins');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
