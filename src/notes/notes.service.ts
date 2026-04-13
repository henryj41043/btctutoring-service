import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NotesModel } from '../models/notes.model';
import { Note } from '../models/note.model';

@Injectable()
export class NotesService {
  async getNote(id: string) {
    return NotesModel.scan({
      id: { eq: id },
    })
      .exec()
      .then((note) => {
        return note;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getNotesByAuthor(authorId: string) {
    return NotesModel.scan({
      author_id: { eq: authorId },
    })
      .exec()
      .then((notes) => {
        return notes;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getNotesByRecipient(recipientId: string) {
    return NotesModel.scan({
      recipient_id: { eq: recipientId },
    })
      .exec()
      .then((notes) => {
        return notes;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getNotes() {
    return NotesModel.scan()
      .exec()
      .then((notes) => {
        return notes;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async createNote(note: Note) {
    const newUuid: string = randomUUID();
    const newNote = new NotesModel({
      id: newUuid,
      message: note.message,
      date_time: note.date_time,
      author: note.author,
      author_id: note.author_id,
      recipient: note.recipient,
      recipient_id: note.recipient_id,
      type: note.type,
    });
    return newNote
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Note created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async updateNote(note: Note) {
    return NotesModel.update(
      {
        id: note.id,
      },
      {
        message: note.message,
        date_time: note.date_time,
        author: note.author,
        author_id: note.author_id,
        recipient: note.recipient,
        recipient_id: note.recipient_id,
        type: note.type,
      },
    )
      .then((updatedNote) => {
        return updatedNote;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async deleteNote(id: string) {
    return NotesModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Note deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
