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
import { StudentsService } from './students.service';
import { AuthGuard } from '@nestjs/passport';
import express from 'express';
import { User } from '../models/user.model';
import { Student } from '../models/student.model';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getStudents(
    @Request() req: express.Request,
    @Query('id') id: string,
    @Query('contact') contactId: string,
    @Query('tutor') tutorId: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      if (id) {
        return this.studentsService.getStudent(id);
      } else if (contactId) {
        return this.studentsService.getStudentsByContact(contactId);
      } else if (tutorId) {
        return this.studentsService.getStudentsByTutor(tutorId);
      } else {
        return this.studentsService.getStudents();
      }
    } else {
      Logger.error('User not authorized to get students');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createStudent(
    @Request() req: express.Request,
    @Body() student: Student,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.studentsService.createStudent(student);
    } else {
      Logger.error('User not authorized to create students');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateStudent(
    @Request() req: express.Request,
    @Body() student: Student,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.studentsService.updateStudent(student);
    } else {
      Logger.error('User not authorized to update students');
      return Promise.reject(new Error('Unauthorized'));
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteStudent(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = user.groups.includes('Admins');
    if (isAdmin) {
      return this.studentsService.deleteStudent(id);
    } else {
      Logger.error('User not authorized to delete students');
      return Promise.reject(new Error('Unauthorized'));
    }
  }
}
