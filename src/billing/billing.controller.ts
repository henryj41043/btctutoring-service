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
import { BillingService } from './billing.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { BillingRecord } from '../models/billing-record.model';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  private assertAdmin(req: express.Request): void {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (!isAdmin) {
      Logger.error('Billing is restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getBillingRecords(
    @Request() req: express.Request,
    @Query('contact') contact: string,
    @Query('period') period: string,
    @Query('month') month: string,
  ): Promise<any> {
    this.assertAdmin(req);
    if (contact) {
      return this.billingService.getBillingRecordsByContact(contact);
    } else if (period) {
      return this.billingService.getBillingRecordsByPeriod(period);
    } else if (month) {
      // 'YYYY-MM' — matches both of the month's period_start dates.
      return this.billingService.getBillingRecordsByMonth(month);
    }
    return this.billingService.getBillingRecords();
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async upsertBillingRecord(
    @Request() req: express.Request,
    @Body() record: BillingRecord,
  ) {
    this.assertAdmin(req);
    return this.billingService.upsertBillingRecord(record);
  }
}
