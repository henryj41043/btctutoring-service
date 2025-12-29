import { Injectable, Logger } from '@nestjs/common';
import { SessionsModel } from '../models/sessions.model';
import { Session } from '../models/session.model';
import { randomUUID } from 'crypto';

@Injectable()
export class SessionsService {
  async getSessions(tutor: string, student: string) {
    return SessionsModel.scan({
      tutor_id: { eq: tutor },
      student_id: { eq: student },
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
      tutor_id: { eq: tutor },
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
      student_id: { eq: student },
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
      end_datetime: session.end_datetime,
      notes: session.notes,
      start_datetime: session.start_datetime,
      status: session.status,
      student_id: session.student_id,
      student_name: session.student_name,
      tutor_id: session.tutor_id,
      tutor_name: session.tutor_name,
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
        end_datetime: session.end_datetime,
        notes: session.notes,
        start_datetime: session.start_datetime,
        status: session.status,
        student_id: session.student_id,
        student_name: session.student_name,
        tutor_id: session.tutor_id,
        tutor_name: session.tutor_name,
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
