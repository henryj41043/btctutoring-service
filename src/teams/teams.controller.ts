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
  Request,
  UseGuards,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Team } from '../models/team.model';

/**
 * Admin-only CRUD. Lead Tutors never call these endpoints — their team is
 * resolved server-side inside GET /sessions, so team membership is never
 * client-asserted.
 */
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getTeams(@Request() req: express.Request): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.teamsService.getTeams();
    } else {
      Logger.error('User not authorized to get teams');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createTeam(@Request() req: express.Request, @Body() team: Team) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.teamsService.createTeam(team);
    } else {
      Logger.error('User not authorized to create teams');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateTeam(@Request() req: express.Request, @Body() team: Team) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.teamsService.updateTeam(team);
    } else {
      Logger.error('User not authorized to update teams');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteTeam(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.teamsService.deleteTeam(id);
    } else {
      Logger.error('User not authorized to delete teams');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
