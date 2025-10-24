import { Injectable, Logger } from '@nestjs/common';
import { SessionsModel } from '../models/sessions.model';
import { Session } from '../models/session.model';
import { randomUUID } from 'crypto';

@Injectable()
export class SessionsService {
  async getSessions(tutor: string, student: string) {
    return SessionsModel.scan({
      tutor: { eq: tutor },
      student: { eq: student },
    })
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getSessionsByTutor(tutor: string) {
    return SessionsModel.scan({
      tutor: { eq: tutor },
    })
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getSessionsByStudent(student: string) {
    return SessionsModel.scan({
      student: { eq: student },
    })
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getAllSessions() {
    return SessionsModel.scan()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async createSession(session: Session) {
    const newUuid: string = randomUUID();
    const newSession = new SessionsModel({
      id: newUuid,
      tutor: session.tutor,
      student: session.student,
      start: session.start,
      end: session.end,
      completed: session.completed,
      makeup: session.makeup,
    });
    return newSession
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Session created successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async updateSession(session: Session) {
    return SessionsModel.update(
      {
        id: session.id,
      },
      {
        tutor: session.tutor,
        student: session.student,
        start: session.start,
        end: session.end,
        completed: session.completed,
        makeup: session.makeup,
      },
    )
      .then((updatedSession) => {
        return updatedSession;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async deleteSession(id: string) {
    return SessionsModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Session deleted successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }
}
