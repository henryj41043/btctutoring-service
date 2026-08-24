import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ScholarshipsService } from './scholarships.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { ScholarshipRecord } from '../models/scholarship-record.model';

@Controller('scholarships')
export class ScholarshipsController {
  constructor(private readonly scholarshipsService: ScholarshipsService) {}

  private assertAdmin(req: express.Request): void {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (!isAdmin) {
      Logger.error('Scholarship records are restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getScholarshipRecords(
    @Request() req: express.Request,
    @Query('contact') contact: string,
    @Query('month') month: string,
  ): Promise<any> {
    this.assertAdmin(req);
    if (contact) {
      return this.scholarshipsService.getScholarshipRecordsByContact(contact);
    } else if (month) {
      return this.scholarshipsService.getScholarshipRecordsByMonth(month);
    }
    return this.scholarshipsService.getScholarshipRecords();
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async upsertScholarshipRecord(
    @Request() req: express.Request,
    @Body() record: ScholarshipRecord,
  ) {
    this.assertAdmin(req);
    return this.scholarshipsService.upsertScholarshipRecord(record);
  }
}
