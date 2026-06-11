import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsModel } from '../models/students.model';
import { Student } from '../models/student.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/students.model', () => ({
  StudentsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = StudentsModel as unknown as ModelMock;

const sampleStudent = (overrides: Partial<Student> = {}): Student =>
  ({
    id: 'student-1',
    contact_id: 'contact-1',
    name: 'Pat',
    birthday: '2015-05-05',
    status: 'Active',
    assigned_tutor_id: 'tutor@example.com',
    package: 'Standard',
    available_minutes: 120,
    make_up_minutes: 0,
    ...overrides,
  }) as Student;

describe('StudentsService', () => {
  let service: StudentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StudentsService],
    }).compile();
    service = module.get<StudentsService>(StudentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('read queries', () => {
    it('getStudent scans by id', async () => {
      scanResolves(Model, [sampleStudent()]);
      await service.getStudent('student-1');
      expect(Model.scan).toHaveBeenCalledWith({ id: { eq: 'student-1' } });
    });

    it('getStudentsByContact scans by contact_id', async () => {
      scanResolves(Model, []);
      await service.getStudentsByContact('contact-1');
      expect(Model.scan).toHaveBeenCalledWith({
        contact_id: { eq: 'contact-1' },
      });
    });

    it('getStudentsByTutor scans by assigned_tutor_id', async () => {
      scanResolves(Model, []);
      await service.getStudentsByTutor('tutor@example.com');
      expect(Model.scan).toHaveBeenCalledWith({
        assigned_tutor_id: { eq: 'tutor@example.com' },
      });
    });

    it('getStudents scans everything', async () => {
      scanResolves(Model, []);
      await service.getStudents();
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it.each([
      ['getStudent', () => service.getStudent('x')],
      ['getStudentsByContact', () => service.getStudentsByContact('x')],
      ['getStudentsByTutor', () => service.getStudentsByTutor('x')],
      ['getStudents', () => service.getStudents()],
    ])('%s rejects when the scan fails', async (_name, call) => {
      scanRejects(Model, new Error('scan boom'));
      await expect(call()).rejects.toThrow('scan boom');
    });
  });

  describe('createStudent', () => {
    it('saves a student and returns a generated id', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createStudent(sampleStudent());
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Student created successfully.',
      });
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createStudent(sampleStudent())).rejects.toThrow(
        'save boom',
      );
    });
  });

  describe('updateStudent', () => {
    it('updates and returns the student', async () => {
      const updated = sampleStudent({ status: 'Inactive' });
      Model.update.mockResolvedValue(updated);
      const result = await service.updateStudent(sampleStudent());
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({ name: 'Pat' }),
      );
      expect(result).toBe(updated);
    });

    it('rejects when update fails', async () => {
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateStudent(sampleStudent())).rejects.toThrow(
        'update boom',
      );
    });
  });

  describe('deleteStudent', () => {
    it('deletes the student and returns a confirmation', async () => {
      Model.delete.mockResolvedValue(undefined);
      await expect(service.deleteStudent('student-1')).resolves.toEqual({
        id: 'student-1',
        message: 'Student deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'student-1' });
    });

    it('rejects when delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteStudent('student-1')).rejects.toThrow(
        'delete boom',
      );
    });
  });
});
