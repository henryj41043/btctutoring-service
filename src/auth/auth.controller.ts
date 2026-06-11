import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  Logger,
  Delete,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { ConfirmDto } from './dto/confirm.dto';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { CreateUserDto } from './dto/create.user.dto';
import { NewPasswordDto } from './dto/new.password.dto';
import { ResponseDto } from './dto/response.dto';
import { ChangePasswordDto } from './dto/change.password.dto';
import { ForgotPasswordDto } from './dto/forgot.password.dto';
import { ConfirmForgotPasswordDto } from './dto/confirm.forgot.password.dto';
import {
  AuthenticationResultType,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getUser(@Request() req: express.Request): Promise<User> {
    return Promise.resolve(req.user as User);
  }

  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<ResponseDto> {
    return this.authService.signup(dto.email, dto.password);
  }

  @Post('confirm')
  confirm(@Body() dto: ConfirmDto): Promise<ResponseDto> {
    return this.authService.confirm(dto.email, dto.code);
  }

  @Post('login')
  login(
    @Body() dto: LoginDto,
  ): Promise<ResponseDto | AuthenticationResultType> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('complete-new-password')
  completeNewPassword(
    @Body() dto: NewPasswordDto,
  ): Promise<ResponseDto | AuthenticationResultType> {
    return this.authService.respondToNewPasswordChallenge(
      dto.username,
      dto.newPassword,
      dto.session,
    );
  }

  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Request() req: express.Request,
    @Body() dto: ChangePasswordDto,
  ): Promise<ResponseDto> {
    const authHeader: string = req.headers.authorization ?? '';
    const accessToken: string = authHeader.replace(/^Bearer\s+/i, '');
    return this.authService.changePassword(
      accessToken,
      dto.previousPassword,
      dto.proposedPassword,
    );
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ResponseDto> {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('confirm-forgot-password')
  confirmForgotPassword(
    @Body() dto: ConfirmForgotPasswordDto,
  ): Promise<ResponseDto> {
    return this.authService.confirmForgotPassword(
      dto.email,
      dto.code,
      dto.newPassword,
    );
  }

  @Post('user')
  @UseGuards(AuthGuard('jwt'))
  async createUser(
    @Request() req: express.Request,
    @Body() dto: CreateUserDto,
  ): Promise<ResponseDto | UserType> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (!isAdmin) {
      Logger.error('Only Admins have access to user data');
      throw new ForbiddenException('Unauthorized');
    }
    return this.authService.adminCreateUser(dto.email, dto.group, dto.id);
  }

  @Delete('user/:id')
  @UseGuards(AuthGuard('jwt'))
  async deleteUser(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<ResponseDto> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    const isNotSelf: boolean = user.email !== id;
    if (isAdmin && isNotSelf) {
      return this.authService.adminDeleteUser(id);
    } else {
      Logger.error('Only Admins have access to user data');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
