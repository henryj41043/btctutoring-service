import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { User } from '../models/user.model';
import { Student } from '../models/student.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};

const lead: User = {
  username: 'lead',
  email: 'lead@example.com',
  groups: ['LeadTutors'],
  contact: 'c-lead',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const student = { id: 'student-1', name: 'Pat' } as Student;

describe('StudentsController', () => {
  let controller: StudentsController;
  let service: jest.Mocked<StudentsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<StudentsService>> = {
      getStudent: jest.fn(),
      getStudentsByContact: jest.fn(),
      getStudentsByTutor: jest.fn(),
      getStudents: jest.fn(),
      getOnboardingStudents: jest.fn(),
      withContactNames: jest.fn(),
      createStudent: jest.fn(),
      updateStudent: jest.fn(),
      deleteStudent: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [{ provide: StudentsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(StudentsController);
    service = module.get(StudentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStudents routing (admin only)', () => {
    it('admin + id -> getStudent', async () => {
      await controller.getStudents(reqAs(admin), 'student-1', '', '', '');
      expect(service.getStudent).toHaveBeenCalledWith('student-1');
    });

    it('admin + contact -> getStudentsByContact', async () => {
      await controller.getStudents(reqAs(admin), '', 'contact-1', '', '');
      expect(service.getStudentsByContact).toHaveBeenCalledWith('contact-1');
    });

    it('admin + tutor -> getStudentsByTutor', async () => {
      service.getStudentsByTutor.mockResolvedValue([] as never);
      await controller.getStudents(
        reqAs(admin),
        '',
        '',
        'tutor@example.com',
        '',
      );
      expect(service.getStudentsByTutor).toHaveBeenCalledWith(
        'tutor@example.com',
      );
      expect(service.withContactNames).not.toHaveBeenCalled();
    });

    it('admin + no params -> getStudents', async () => {
      service.getStudents.mockResolvedValue([] as never);
      await controller.getStudents(reqAs(admin), '', '', '', '');
      expect(service.getStudents).toHaveBeenCalled();
      expect(service.withContactNames).not.toHaveBeenCalled();
    });

    it('include=contact_name enriches the all-students listing', async () => {
      const students = [student];
      const enriched = [{ ...student, contact_name: 'Ann Lee' }];
      service.getStudents.mockResolvedValue(students as never);
      service.withContactNames.mockResolvedValue(enriched as never);
      const result = await controller.getStudents(
        reqAs(admin),
        '',
        '',
        '',
        'contact_name',
      );
      expect(service.withContactNames).toHaveBeenCalledWith(students);
      expect(result).toEqual(enriched);
    });

    it('include=contact_name enriches the by-tutor listing', async () => {
      const students = [student];
      const enriched = [{ ...student, contact_name: 'Ann Lee' }];
      service.getStudentsByTutor.mockResolvedValue(students as never);
      service.withContactNames.mockResolvedValue(enriched as never);
      const result = await controller.getStudents(
        reqAs(admin),
        '',
        '',
        'tutor@example.com',
        'contact_name',
      );
      expect(service.withContactNames).toHaveBeenCalledWith(students);
      expect(result).toEqual(enriched);
    });

    it('non-admin -> unauthorized', async () => {
      await expect(
        controller.getStudents(reqAs(tutor), 'student-1', '', '', ''),
      ).rejects.toThrow('Unauthorized');
      expect(service.getStudent).not.toHaveBeenCalled();
    });
  });

  describe('getStudents tutor self-roster', () => {
    it('a lead tutor lists their own assigned students (roster stays self-only)', async () => {
      service.getStudentsByTutor.mockResolvedValue([student] as never);
      const result = await controller.getStudents(reqAs(lead), '', '', 'c-lead', '');
      expect(service.getStudentsByTutor).toHaveBeenCalledWith('c-lead');
      expect(result).toEqual([student]);
    });

    it("a lead tutor cannot list a member's students", async () => {
      await expect(
        controller.getStudents(reqAs(lead), '', '', 'c-m1', ''),
      ).rejects.toThrow('Unauthorized');
      expect(service.getStudentsByTutor).not.toHaveBeenCalled();
    });

    it('a tutor lists their own assigned students by contact id', async () => {
      const students = [student];
      service.getStudentsByTutor.mockResolvedValue(students as never);
      const result = await controller.getStudents(
        reqAs(tutor),
        '',
        '',
        'c-tutor',
        '',
      );
      expect(service.getStudentsByTutor).toHaveBeenCalledWith('c-tutor');
      expect(result).toEqual(students);
    });

    it('a tutor gets contact_name enrichment on their own roster', async () => {
      const students = [student];
      const enriched = [{ ...student, contact_name: 'Ann Lee' }];
      service.getStudentsByTutor.mockResolvedValue(students as never);
      service.withContactNames.mockResolvedValue(enriched as never);
      const result = await controller.getStudents(
        reqAs(tutor),
        '',
        '',
        'c-tutor',
        'contact_name',
      );
      expect(service.withContactNames).toHaveBeenCalledWith(students);
      expect(result).toEqual(enriched);
    });

    it("a tutor cannot list another tutor's students", async () => {
      await expect(
        controller.getStudents(reqAs(tutor), '', '', 'c-someone-else', ''),
      ).rejects.toThrow('Unauthorized');
      expect(service.getStudentsByTutor).not.toHaveBeenCalled();
    });

    it('a user with no cognito groups is rejected, not crashed', async () => {
      const groupless: User = {
        username: 'nogroups',
        email: 'nogroups@example.com',
        groups: undefined as unknown as string[],
        contact: 'c-nogroups',
      };
      await expect(
        controller.getStudents(reqAs(groupless), '', '', '', ''),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.getOnboardingStudents(reqAs(groupless)),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.createStudent(reqAs(groupless), student),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.updateStudent(reqAs(groupless), student),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.deleteStudent(reqAs(groupless), 'student-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('getOnboardingStudents (admin only)', () => {
    it('admin -> getOnboardingStudents', async () => {
      await controller.getOnboardingStudents(reqAs(admin));
      expect(service.getOnboardingStudents).toHaveBeenCalled();
    });

    it('non-admin -> unauthorized', async () => {
      await expect(
        controller.getOnboardingStudents(reqAs(tutor)),
      ).rejects.toThrow('Unauthorized');
      expect(service.getOnboardingStudents).not.toHaveBeenCalled();
    });
  });

  describe('mutations (admin only)', () => {
    it('admin creates a student', async () => {
      await controller.createStudent(reqAs(admin), student);
      expect(service.createStudent).toHaveBeenCalledWith(student);
    });

    it('non-admin cannot create', async () => {
      await expect(
        controller.createStudent(reqAs(tutor), student),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin updates a student', async () => {
      await controller.updateStudent(reqAs(admin), student);
      expect(service.updateStudent).toHaveBeenCalledWith(student);
    });

    it('non-admin cannot update', async () => {
      await expect(
        controller.updateStudent(reqAs(tutor), student),
      ).rejects.toThrow('Unauthorized');
    });

    it('admin deletes a student', async () => {
      await controller.deleteStudent(reqAs(admin), 'student-1');
      expect(service.deleteStudent).toHaveBeenCalledWith('student-1');
    });

    it('non-admin cannot delete', async () => {
      await expect(
        controller.deleteStudent(reqAs(tutor), 'student-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
