import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('create')
  async createUser(@Body() user: User): Promise<any> {
    return this.usersService.createUser(user);
  }

  @Post('login')
  async login(@Body() user: User): Promise<any> {
    return this.usersService.login(user);
  }

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<any> {
    return this.usersService.getUserById(id);
  }
}
