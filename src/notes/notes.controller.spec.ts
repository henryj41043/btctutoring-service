import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { User } from '../models/user.model';
import { Note } from '../models/note.model';

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

const groupless: User = {
  username: 'nogroups',
  email: 'nogroups@example.com',
  groups: undefined as unknown as string[],
  contact: 'c-nogroups',
};
const lead: User = {
  username: 'lead',
  email: 'lead@example.com',
  groups: ['LeadTutors'],
  contact: 'c-lead',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const note = { id: 'note-1', message: 'hi' } as Note;

describe('NotesController', () => {
  let controller: NotesController;
  let service: jest.Mocked<NotesService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<NotesService>> = {
      getNote: jest.fn(),
      getNotesByAuthor: jest.fn(),
      getNotesByRecipient: jest.fn(),
      getNotes: jest.fn(),
      createNote: jest.fn(),
      updateNote: jest.fn(),
      deleteNote: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotesController],
      providers: [{ provide: NotesService, useValue: serviceMock }],
    }).compile();
    controller = module.get(NotesController);
    service = module.get(NotesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getNotes routing (admin only)', () => {
    it('admin + id -> getNote', async () => {
      await controller.getNotes(reqAs(admin), 'note-1', '', '');
      expect(service.getNote).toHaveBeenCalledWith('note-1');
    });

    it('admin + author -> getNotesByAuthor', async () => {
      await controller.getNotes(reqAs(admin), '', 'tutor@example.com', '');
      expect(service.getNotesByAuthor).toHaveBeenCalledWith(
        'tutor@example.com',
      );
    });

    it('admin + recipient -> getNotesByRecipient', async () => {
      await controller.getNotes(reqAs(admin), '', '', 'student-1');
      expect(service.getNotesByRecipient).toHaveBeenCalledWith('student-1');
    });

    it('admin + no params -> getNotes', async () => {
      await controller.getNotes(reqAs(admin), '', '', '');
      expect(service.getNotes).toHaveBeenCalled();
    });

    it('non-admin -> unauthorized', async () => {
      await expect(
        controller.getNotes(reqAs(tutor), 'note-1', '', ''),
      ).rejects.toThrow('Unauthorized');
    });

    it('a tutor reads the notes on their own contact record', async () => {
      service.getNotesByRecipient.mockResolvedValue([] as never);
      await controller.getNotes(reqAs(tutor), '', '', 'c-tutor');
      expect(service.getNotesByRecipient).toHaveBeenCalledWith('c-tutor');
    });

    it("a tutor cannot read another contact's notes", async () => {
      await expect(
        controller.getNotes(reqAs(tutor), '', '', 'c-someone-else'),
      ).rejects.toThrow('Unauthorized');
      expect(service.getNotesByRecipient).not.toHaveBeenCalled();
    });

    it('a lead tutor reads the notes on their own contact record', async () => {
      service.getNotesByRecipient.mockResolvedValue([] as never);
      await controller.getNotes(reqAs(lead), '', '', 'c-lead');
      expect(service.getNotesByRecipient).toHaveBeenCalledWith('c-lead');
    });

    it("a lead tutor cannot read another contact's notes", async () => {
      await expect(
        controller.getNotes(reqAs(lead), '', '', 'c-m1'),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('groups hardening', () => {
    it('a user with no cognito groups is rejected everywhere, not crashed', async () => {
      await expect(
        controller.getNotes(reqAs(groupless), '', '', ''),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.createNote(reqAs(groupless), note),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.updateNote(reqAs(groupless), note),
      ).rejects.toThrow('Unauthorized');
      await expect(
        controller.deleteNote(reqAs(groupless), 'note-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('mutations (admin only)', () => {
    it('admin creates a note', async () => {
      await controller.createNote(reqAs(admin), note);
      expect(service.createNote).toHaveBeenCalledWith(note);
    });

    it('non-admin cannot create', async () => {
      await expect(controller.createNote(reqAs(tutor), note)).rejects.toThrow(
        'Unauthorized',
      );
    });

    it('admin updates a note', async () => {
      await controller.updateNote(reqAs(admin), note);
      expect(service.updateNote).toHaveBeenCalledWith(note);
    });

    it('non-admin cannot update', async () => {
      await expect(controller.updateNote(reqAs(tutor), note)).rejects.toThrow(
        'Unauthorized',
      );
    });

    it('admin deletes a note', async () => {
      await controller.deleteNote(reqAs(admin), 'note-1');
      expect(service.deleteNote).toHaveBeenCalledWith('note-1');
    });

    it('non-admin cannot delete', async () => {
      await expect(
        controller.deleteNote(reqAs(tutor), 'note-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
