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
import { ContactsService } from './contacts.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Contact } from '../models/contact.model';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getContacts(
    @Request() req: express.Request,
    @Query('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      if (id) {
        return this.contactsService.getContact(id);
      } else {
        return this.contactsService.getContacts();
      }
    } else {
      Logger.error('User not authorized to get contacts');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createContact(
    @Request() req: express.Request,
    @Body() contact: Contact,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.contactsService.createContact(contact);
    } else {
      Logger.error('User not authorized to create contacts');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateContact(
    @Request() req: express.Request,
    @Body() contact: Contact,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.contactsService.updateContact(contact);
    } else {
      Logger.error('User not authorized to update contacts');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteContact(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.contactsService.deleteContact(id);
    } else {
      Logger.error('User not authorized to delete contacts');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
