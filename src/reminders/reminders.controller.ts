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
import { RemindersService } from './reminders.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Reminder } from '../models/reminder.model';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getReminders(@Request() req: express.Request): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.getReminders();
    } else {
      Logger.error('User not authorized to get reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createReminder(
    @Request() req: express.Request,
    @Body() reminder: Reminder,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.createReminder(reminder);
    } else {
      Logger.error('User not authorized to create reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateReminder(
    @Request() req: express.Request,
    @Body() reminder: Reminder,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.updateReminder(reminder);
    } else {
      Logger.error('User not authorized to update reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/complete')
  @UseGuards(AuthGuard('jwt'))
  async completeReminder(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.completeReminder(id);
    } else {
      Logger.error('User not authorized to complete reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/ack')
  @UseGuards(AuthGuard('jwt'))
  async ackReminder(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      // The ack is pinned to the caller's own contact id from the JWT.
      return this.remindersService.ackReminder(id, user.contact);
    } else {
      Logger.error('User not authorized to ack reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/unack')
  @UseGuards(AuthGuard('jwt'))
  async unackReminder(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.unackReminder(id, user.contact);
    } else {
      Logger.error('User not authorized to unack reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/uncomplete')
  @UseGuards(AuthGuard('jwt'))
  async uncompleteReminder(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.uncompleteReminder(id);
    } else {
      Logger.error('User not authorized to reopen reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteReminder(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.remindersService.deleteReminder(id);
    } else {
      Logger.error('User not authorized to delete reminders');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
