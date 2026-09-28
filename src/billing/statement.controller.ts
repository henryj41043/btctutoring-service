import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Statement } from './statement-engine';
import {
  FreezeResult,
  StatementPreviewRequest,
  StatementService,
} from './statement.service';

/**
 * Billing v2 statements: what each family owes in a month, calculated by the
 * service so the app only displays it. Admin only.
 */
@Controller('billing/statements')
export class StatementController {
  constructor(private readonly statements: StatementService) {}

  private assertAdmin(req: express.Request): void {
    const user: User = req.user as User;
    if (!(user.groups ?? []).includes('Admins')) {
      Logger.error('Billing statements are restricted to admins');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getStatements(
    @Request() req: express.Request,
    @Query('month') month: string,
  ): Promise<Statement[]> {
    this.assertAdmin(req);
    return this.statements.getStatements(month);
  }

  /** Freezes a month that has ended (normally done by the 1st-of-month run). */
  @Post('freeze')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async freeze(
    @Request() req: express.Request,
    @Query('month') month: string,
  ): Promise<FreezeResult> {
    this.assertAdmin(req);
    return this.statements.freezeMonth(month);
  }

  /** The family's statement with an unsaved student change applied. */
  @Post('preview')
  @HttpCode(200)
  @UseGuards(AuthGuard('jwt'))
  async preview(
    @Request() req: express.Request,
    @Body() request: StatementPreviewRequest,
  ): Promise<{ statement: Statement | null }> {
    this.assertAdmin(req);
    return { statement: await this.statements.previewStatement(request) };
  }
}
