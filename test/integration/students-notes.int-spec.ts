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

    it('admin saves a custom price and discount; null clears them', async () => {
      StudentModel.update.mockResolvedValue({ id: 's-1' });
      const save = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({ id: 's-1', price_override: 410.4, discount_percent: 10 });
      expect(save.status).toBe(200);
      expect(StudentModel.update).toHaveBeenLastCalledWith(
        { id: 's-1' },
        { price_override: 410.4, discount_percent: 10 },
      );

      const clear = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({ id: 's-1', price_override: null, discount_percent: null });
      expect(clear.status).toBe(200);
      expect(StudentModel.update).toHaveBeenLastCalledWith(
        { id: 's-1' },
        {
          $SET: {},
          $REMOVE: ['price_override', 'discount_percent', 'discount_reason'],
        },
      );
    });

    it('admin schedules a package change on any future date, with a price', async () => {
      const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      StudentModel.update.mockResolvedValue({ id: 's-1' });
      StudentModel.get.mockResolvedValue({ id: 's-1' });
      const res = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({
          id: 's-1',
          pending_changes: [
            { package: 'Excel', effective: soon, price_override: 300 },
          ],
        });
      expect(res.status).toBe(200);
      const update = StudentModel.update.mock.calls.at(-1)![1] as {
        $SET: { pending_changes: unknown[] };
      };
      expect(update.$SET.pending_changes).toEqual([
        { package: 'Excel', effective: soon, price_override: 300 },
      ]);
    });

    it('rejects a package change dated in the past', async () => {
      StudentModel.update.mockClear();
      StudentModel.get.mockResolvedValue({ id: 's-1' });
      const res = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({
          id: 's-1',
          pending_changes: [{ package: 'Excel', effective: '2020-01-15' }],
        });
      expect(res.status).toBe(400);
      expect(StudentModel.update).not.toHaveBeenCalled();
    });

    it('admin saves first-week sessions; one outside the start week is rejected', async () => {
      StudentModel.update.mockResolvedValue({ id: 's-1' });
      const oneOff = {
        date: '2026-09-12',
        start_time: '11:00',
        end_time: '11:45',
      };
      const ok = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({
          id: 's-1',
          package_start_date: '2026-09-11T00:00:00',
          first_week_sessions: [oneOff],
        });
      expect(ok.status).toBe(200);
      expect(StudentModel.update).toHaveBeenLastCalledWith(
        { id: 's-1' },
        {
          package_start_date: '2026-09-11T00:00:00',
          first_week_sessions: [oneOff],
        },
      );
      StudentModel.update.mockClear();
      const bad = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({
          id: 's-1',
          package_start_date: '2026-09-11T00:00:00',
          first_week_sessions: [{ ...oneOff, date: '2026-09-25' }],
        });
      expect(bad.status).toBe(400);
      expect(StudentModel.update).not.toHaveBeenCalled();
    });

    it('rejects a discount above 100 percent', async () => {
      StudentModel.update.mockClear();
      const res = await request(server())
        .put('/students')
        .set('x-test-role', 'admin')
        .send({ id: 's-1', discount_percent: 120 });
      expect(res.status).toBe(400);
      expect(StudentModel.update).not.toHaveBeenCalled();
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

    it('a tutor cannot read the notes on their own contact record', async () => {
      const res = await request(server())
        .get('/notes?recipient=contact-tutor')
        .set('x-test-role', 'tutor');
      expect(res.status).toBe(403);
      expect(NoteModel.scan).not.toHaveBeenCalled();
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
