import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Employee } from '../models/employee.model';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getEmployees(
    @Request() req: express.Request,
    @Query('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (!isAdmin) {
      Logger.error('Only Admins have access to employee data');
      return Promise.reject(new Error('Unauthorized'));
    }
    if (id) {
      return this.employeesService.getEmployee(id);
    } else {
      return this.employeesService.getAllEmployees();
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createEmployee(
    @Request() req: express.Request,
    @Body() employee: Employee,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (!isAdmin) {
      Logger.error('Only Admins have access to employee data');
      return Promise.reject(new Error('Unauthorized'));
    } else {
      return this.employeesService.createEmployee(employee);
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateClient(
    @Request() req: express.Request,
    @Body() employee: Employee,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.employeesService.updateEmployee(employee);
    } else {
      Logger.error('Only Admins have access to employee data');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteClient(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.employeesService.deleteEmployee(id);
    } else {
      Logger.error('Only Admins have access to employee data');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
