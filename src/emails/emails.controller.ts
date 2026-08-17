import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { EmailsService } from './emails.service';
import { User } from '../models/user.model';
import { AssignEmailDto } from './dto/assign-email.dto';

/** Admin-only throughout: inbound emails are parent correspondence. */
@Controller('emails')
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @Get('contact/:contactId')
  @UseGuards(AuthGuard('jwt'))
  async getEmailsByContact(
    @Request() req: express.Request,
    @Param('contactId') contactId: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.emailsService.getEmailsByContact(contactId);
    } else {
      Logger.error('User not authorized to get contact emails');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get('unmatched')
  @UseGuards(AuthGuard('jwt'))
  async getUnmatchedEmails(@Request() req: express.Request): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.emailsService.getUnmatchedEmails();
    } else {
      Logger.error('User not authorized to get unmatched emails');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/assign')
  @UseGuards(AuthGuard('jwt'))
  async assignEmail(
    @Request() req: express.Request,
    @Param('id') id: string,
    @Body() body: AssignEmailDto,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.emailsService.assignEmail(id, body.contact_id, user.username);
    } else {
      Logger.error('User not authorized to assign emails');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post(':id/discard')
  @UseGuards(AuthGuard('jwt'))
  async discardEmail(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.emailsService.discardEmail(id);
    } else {
      Logger.error('User not authorized to discard emails');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get(':id/original-url')
  @UseGuards(AuthGuard('jwt'))
  async getOriginalUrl(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.emailsService.getOriginalUrl(id);
    } else {
      Logger.error('User not authorized to view original emails');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
