import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { FamilyService } from './family.service';
import { FamilyView } from './family-view';

@Controller('family')
export class FamilyController {
  constructor(private readonly familyService: FamilyService) {}

  /** The read-only family page for tutors (client 2026-11-09). */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  async getFamily(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<FamilyView> {
    return this.familyService.getFamilyView(id, req.user as User);
  }
}
