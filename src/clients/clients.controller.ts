import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Client } from '../models/client.model';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getClients(
    @Request() req: express.Request,
    @Query('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (!isAdmin) {
      Logger.error('Only Admins have access to client data');
      return Promise.reject(new Error('Unauthorized'));
    }
    if (id) {
      return this.clientsService.getClient(id);
    } else {
      return this.clientsService.getAllClients();
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createClient(
    @Request() req: express.Request,
    @Body() client: Client,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (!isAdmin) {
      Logger.error('Only Admins have access to client data');
      return Promise.reject(new Error('Unauthorized'));
    } else {
      return this.clientsService.createClient(client);
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateClient(
    @Request() req: express.Request,
    @Body() client: Client,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    const isTutor: boolean = user.groups.includes('Tutors');
    if (isAdmin || isTutor) {
      return this.clientsService.updateClient(client);
    } else {
      Logger.error('Invalid credentials for updating client data');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete()
  @UseGuards(AuthGuard('jwt'))
  async deleteClient(
    @Request() req: express.Request,
    @Query('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.clientsService.deleteClient(id);
    } else {
      Logger.error('Deleting a client is restricted to admins');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
