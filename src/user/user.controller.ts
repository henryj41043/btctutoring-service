import { Controller, Get, Headers, Request, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getSessions(
    @Request() req: express.Request,
    @Headers('X-ID-Token') idToken: string,
  ) {
    return this.userService.getUser(req.user as User, idToken);
  }
}
