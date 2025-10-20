import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Headers,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.schema';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from 'aws-jwt-verify/jwt-model';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('create')
  async createUser(@Body() user: User): Promise<any> {
    return this.usersService.createUser(user);
  }

  @Post('login')
  async login(@Body() user: User): Promise<any> {
    return this.usersService.login(user);
  }

  @Get('user')
  @UseGuards(AuthGuard('jwt'))
  async getUser(
    @Request() req: express.Request,
    @Headers('X-ID-Token') customHeader: string,
  ): Promise<any> {
    const decodedToken = this.jwtService.decode(customHeader);
    return Promise.resolve({
      username: decodedToken['cognito:username'],
      groups: decodedToken['cognito:groups'],
      email: decodedToken.email,
      user: req.user,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get()
  getProtectedData(@Request() req: express.Request) {
    return { user: req.user };
  }
}
