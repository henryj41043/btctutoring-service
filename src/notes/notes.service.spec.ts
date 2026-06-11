import { Test, TestingModule } from '@nestjs/testing';
import { NotesService } from './notes.service';
import { NotesModel } from '../models/notes.model';
import { Note } from '../models/note.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/notes.model', () => ({
  NotesModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = NotesModel as unknown as ModelMock;

const sampleNote = (overrides: Partial<Note> = {}): Note =>
  ({
    id: 'note-1',
    message: 'Great progress today.',
    date_time: '2026-01-01T12:00:00Z',
    author: 'Tess',
    author_id: 'tutor@example.com',
    recipient: 'Pat',
    recipient_id: 'student-1',
    type: 'Session',
    ...overrides,
  }) as Note;

describe('NotesService', () => {
  let service: NotesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotesService],
    }).compile();
    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('read queries', () => {
    it('getNote scans by id', async () => {
      scanResolves(Model, [sampleNote()]);
      await service.getNote('note-1');
      expect(Model.scan).toHaveBeenCalledWith({ id: { eq: 'note-1' } });
    });

    it('getNotesByAuthor scans by author_id', async () => {
      scanResolves(Model, []);
      await service.getNotesByAuthor('tutor@example.com');
      expect(Model.scan).toHaveBeenCalledWith({
        author_id: { eq: 'tutor@example.com' },
      });
    });

    it('getNotesByRecipient scans by recipient_id', async () => {
      scanResolves(Model, []);
      await service.getNotesByRecipient('student-1');
      expect(Model.scan).toHaveBeenCalledWith({
        recipient_id: { eq: 'student-1' },
      });
    });

    it('getNotes scans everything', async () => {
      scanResolves(Model, []);
      await service.getNotes();
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it.each([
      ['getNote', () => service.getNote('x')],
      ['getNotesByAuthor', () => service.getNotesByAuthor('x')],
      ['getNotesByRecipient', () => service.getNotesByRecipient('x')],
      ['getNotes', () => service.getNotes()],
    ])('%s rejects when the scan fails', async (_name, call) => {
      scanRejects(Model, new Error('scan boom'));
      await expect(call()).rejects.toThrow('scan boom');
    });
  });

  describe('createNote', () => {
    it('saves a note and returns a generated id', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createNote(sampleNote());
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Note created successfully.',
      });
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createNote(sampleNote())).rejects.toThrow('save boom');
    });
  });

  describe('updateNote', () => {
    it('updates and returns the note', async () => {
      const updated = sampleNote({ message: 'Updated' });
      Model.update.mockResolvedValue(updated);
      const result = await service.updateNote(sampleNote());
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'note-1' },
        expect.objectContaining({ message: 'Great progress today.' }),
      );
      expect(result).toBe(updated);
    });

    it('rejects when update fails', async () => {
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateNote(sampleNote())).rejects.toThrow(
        'update boom',
      );
    });
  });

  describe('deleteNote', () => {
    it('deletes the note and returns a confirmation', async () => {
      Model.delete.mockResolvedValue(undefined);
      await expect(service.deleteNote('note-1')).resolves.toEqual({
        id: 'note-1',
        message: 'Note deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'note-1' });
    });

    it('rejects when delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteNote('note-1')).rejects.toThrow('delete boom');
    });
  });
});
