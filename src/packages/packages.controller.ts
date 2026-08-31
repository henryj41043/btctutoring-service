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
import { PackagesService } from './packages.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { PackageRow } from '../models/package-row.model';

@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  private assertAdmin(req: express.Request): void {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (!isAdmin) {
      Logger.error('Package management is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  // Deliberately NOT admin-only: tutors resolve package definitions too
  // (session-length validation in the session dialog).
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getPackages(): Promise<any> {
    return this.packagesService.getPackages();
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createPackage(
    @Request() req: express.Request,
    @Body() row: PackageRow,
  ) {
    this.assertAdmin(req);
    return this.packagesService.createPackage(row);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async retirePackage(
    @Request() req: express.Request,
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.packagesService.retirePackage(id);
  }

  @Put(':id/restore')
  @UseGuards(AuthGuard('jwt'))
  async restorePackage(
    @Request() req: express.Request,
    @Param('id') id: string,
  ) {
    this.assertAdmin(req);
    return this.packagesService.restorePackage(id);
  }
}
