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
      await controller.getStudents(reqAs(admin), 'student-1', '', '');
      expect(service.getStudent).toHaveBeenCalledWith('student-1');
    });

    it('admin + contact -> getStudentsByContact', async () => {
      await controller.getStudents(reqAs(admin), '', 'contact-1', '');
      expect(service.getStudentsByContact).toHaveBeenCalledWith('contact-1');
    });

    it('admin + tutor -> getStudentsByTutor', async () => {
      await controller.getStudents(reqAs(admin), '', '', 'tutor@example.com');
      expect(service.getStudentsByTutor).toHaveBeenCalledWith(
        'tutor@example.com',
      );
    });

    it('admin + no params -> getStudents', async () => {
      await controller.getStudents(reqAs(admin), '', '', '');
      expect(service.getStudents).toHaveBeenCalled();
    });

    it('non-admin -> unauthorized', async () => {
      await expect(
        controller.getStudents(reqAs(tutor), 'student-1', '', ''),
      ).rejects.toThrow('Unauthorized');
      expect(service.getStudent).not.toHaveBeenCalled();
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
