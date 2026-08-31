import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StudentsController } from '../../src/students/students.controller';
import { StudentsService } from '../../src/students/students.service';
import { StudentsModel } from '../../src/models/students.model';
import { NotesController } from '../../src/notes/notes.controller';
import { NotesService } from '../../src/notes/notes.service';
import { NotesModel } from '../../src/models/notes.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/students.model', () => ({
  StudentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/notes.model', () => ({
  NotesModel: require('../model-mock').makeModelMock(),
}));

const StudentModel = StudentsModel as unknown as ModelMock;
const NoteModel = NotesModel as unknown as ModelMock;

describe('Students & Notes (integration, admin-only)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [StudentsController, NotesController],
      providers: [StudentsService, NotesService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  describe('students', () => {
    it('admin lists students', async () => {
      scanResolves(StudentModel, [{ id: 'student-1' }]);
      const res = await request(server())
        .get('/students')
        .set('x-test-role', 'admin');
      expect(res.status).toBe(200);
      expect(StudentModel.scan).toHaveBeenCalledWith();
    });

    it('admin filters students by tutor (widened: assigned OR slot tutor)', async () => {
      scanResolves(StudentModel, [
        { id: 's-assigned', assigned_tutor_id: 'tutor@example.com' },
        {
          id: 's-slot',
          assigned_tutor_id: 'other',
          schedule: [
            {
              weekday: 'MONDAY',
              start_time: '10:00',
              end_time: '10:30',
              tutor_id: 'tutor@example.com',
            },
          ],
        },
        { id: 's-other', assigned_tutor_id: 'other' },
      ]);
      const res = await request(server())
        .get('/students?tutor=tutor@example.com')
        .set('x-test-role', 'admin');
      // The per-slot-tutor predicate runs in code over an unfiltered scan.
      expect(StudentModel.scan).toHaveBeenCalledWith();
      expect(res.body.map((s: { id: string }) => s.id)).toEqual([
        's-assigned',
        's-slot',
      ]);
    });

    it('a tutor cannot read students', async () => {
      const res = await request(server())
        .get('/students')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(403);
    });

    it('a tutor lists their own assigned students', async () => {
      scanResolves(StudentModel, []);
      const res = await request(server())
        .get('/students?tutor=contact-tutor')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(200);
      // Widened predicate filters in code — the scan itself is unfiltered.
      expect(StudentModel.scan).toHaveBeenCalledWith();
    });

    it('admin creates a student', async () => {
      StudentModel.__save.mockResolvedValue(undefined);
      const res = await request(server())
        .post('/students')
        .set('x-test-role', 'admin')
        .send({ name: 'Pat', contact_id: 'c-1' });
      expect(res.status).toBe(201);
    });
  });

  describe('notes', () => {
    it('admin lists notes', async () => {
      scanResolves(NoteModel, [{ id: 'note-1' }]);
      const res = await request(server())
        .get('/notes')
        .set('x-test-role', 'admin');
      expect(res.status).toBe(200);
      expect(NoteModel.scan).toHaveBeenCalledWith();
    });

    it('admin filters notes by author', async () => {
      scanResolves(NoteModel, []);
      await request(server())
        .get('/notes?author=tutor@example.com')
        .set('x-test-role', 'admin');
      expect(NoteModel.scan).toHaveBeenCalledWith({
        author_id: { eq: 'tutor@example.com' },
      });
    });

    it('a tutor cannot read notes', async () => {
      const res = await request(server())
        .get('/notes')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(403);
    });

    it('admin creates a note', async () => {
      NoteModel.__save.mockResolvedValue(undefined);
      const res = await request(server())
        .post('/notes')
        .set('x-test-role', 'admin')
        .send({ message: 'hello', author_id: 'tutor@example.com' });
      expect(res.status).toBe(201);
    });
  });
});
