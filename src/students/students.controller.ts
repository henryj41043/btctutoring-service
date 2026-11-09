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
import { isLeadTutor, isTutorLike } from '../models/user-groups';
import { TeamsService } from '../teams/teams.service';

@Controller('students')
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly teamsService: TeamsService,
  ) {}

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
    @Query('team') team?: string,
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
    // Lead Tutors: ?team=self lists the students of the tutors they manage
    // (their Team Roster, client 2026-11-09), resolved server-side through
    // nested teams like the team calendar. Their own students are on My
    // Roster, so they are left out here.
    if (team === 'self' && !isAdmin) {
      if (!isLeadTutor(groups) || !user.contact) {
        Logger.error('Team roster refused: not a lead tutor');
        throw new ForbiddenException('Unauthorized');
      }
      const members = await this.teamsService.resolveTeamTutorIds(user.contact);
      const students = (await this.studentsService.getStudentsByTutors(
        members,
        user.contact,
      )) as unknown as Student[];
      return withNames
        ? this.studentsService.withContactNames(students)
        : students;
    }
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
    }
    // Students are an admin's to edit. Attendance moves make-up minutes
    // through PUT /sessions/:id/attendance, where the service does the math;
    // a tutor has no student write at all.
    Logger.error('User not authorized to update students');
    throw new ForbiddenException('Unauthorized');
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
