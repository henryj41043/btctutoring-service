import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { isTutorLike } from '../models/user-groups';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get('onboarding')
  @UseGuards(AuthGuard('jwt'))
  async getOnboardingStudents(@Request() req: express.Request): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.studentsService.getOnboardingStudents();
    } else {
      Logger.error('User not authorized to get onboarding students');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getStudents(
    @Request() req: express.Request,
    @Query('id') id: string,
    @Query('contact') contactId: string,
    @Query('tutor') tutorId: string,
    @Query('include') include: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const groups: string[] = user.groups ?? [];
    const isAdmin: boolean = groups.includes('Admins');
    // ?include=contact_name denormalizes each student with the family's
    // display name (roster views), skipping a client-side join.
    const withNames = include === 'contact_name';
    // Tutors may list their own assigned students (rosters, payroll credits) —
    // user.contact is the tutor's contact id, which students store as
    // assigned_tutor_id.
    if (
      !isAdmin &&
      isTutorLike(groups) &&
      tutorId &&
      tutorId === user.contact
    ) {
      const students = (await this.studentsService.getStudentsByTutor(
        tutorId,
      )) as unknown as Student[];
      return withNames
        ? this.studentsService.withContactNames(students)
        : students;
    }
    if (isAdmin) {
      if (id) {
        return this.studentsService.getStudent(id);
      } else if (contactId) {
        return this.studentsService.getStudentsByContact(contactId);
      } else if (tutorId) {
        const students = (await this.studentsService.getStudentsByTutor(
          tutorId,
        )) as unknown as Student[];
        return withNames
          ? this.studentsService.withContactNames(students)
          : students;
      } else {
        const students =
          (await this.studentsService.getStudents()) as unknown as Student[];
        return withNames
          ? this.studentsService.withContactNames(students)
          : students;
      }
    } else {
      Logger.error('User not authorized to get students');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  async createStudent(
    @Request() req: express.Request,
    @Body() student: Student,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.studentsService.createStudent(student);
    } else {
      Logger.error('User not authorized to create students');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Put()
  @UseGuards(AuthGuard('jwt'))
  async updateStudent(
    @Request() req: express.Request,
    @Body() student: Student,
  ) {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.studentsService.updateStudent(student);
    } else {
      Logger.error('User not authorized to update students');
      throw new ForbiddenException('Unauthorized');
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  async deleteStudent(
    @Request() req: express.Request,
    @Param('id') id: string,
  ): Promise<any> {
    const user: User = req.user as User;
    const isAdmin: boolean = (user.groups ?? []).includes('Admins');
    if (isAdmin) {
      return this.studentsService.deleteStudent(id);
    } else {
      Logger.error('User not authorized to delete students');
      throw new ForbiddenException('Unauthorized');
    }
  }
}
