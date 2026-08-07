import { Injectable, Logger } from '@nestjs/common';
import { SessionsModel } from '../models/sessions.model';
import { Session } from '../models/session.model';
import { randomUUID } from 'crypto';

/** Optional start_datetime range (ISO strings; ISO sorts lexically). */
export interface SessionRange {
  from?: string;
  to?: string;
}

@Injectable()
export class SessionsService {
  /**
   * Applies an optional start_datetime range to a scan. ISO-8601 strings
   * compare lexically, so plain string bounds are correct.
   */
  private applyRange<
    T extends {
      where: (key: string) => {
        between: (a: string, b: string) => unknown;
        ge: (value: string) => unknown;
        le: (value: string) => unknown;
      };
    },
  >(scan: T, range?: SessionRange): T {
    if (range?.from && range?.to) {
      return scan.where('start_datetime').between(range.from, range.to) as T;
    }
    if (range?.from) {
      return scan.where('start_datetime').ge(range.from) as T;
    }
    if (range?.to) {
      return scan.where('start_datetime').le(range.to) as T;
    }
    return scan;
  }

  async getSessions(tutor: string, student: string, range?: SessionRange) {
    return this.applyRange(
      SessionsModel.scan({
        tutor_id: { eq: tutor },
        student_id: { eq: student },
      }),
      range,
    )
      .all()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getSessionsByTutor(tutor: string, range?: SessionRange) {
    return this.applyRange(
      SessionsModel.scan({
        tutor_id: { eq: tutor },
      }),
      range,
    )
      .all()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  /**
   * All sessions for a set of tutor contact ids (a lead's team view) in one
   * scan pass. Chained .where().in() is required — the object-literal
   * condition form has no `in`. DynamoDB caps IN at 100 operands; team sizes
   * are nowhere near that.
   */
  async getSessionsByTutors(tutorIds: string[], range?: SessionRange) {
    return this.applyRange(
      SessionsModel.scan().where('tutor_id').in(tutorIds),
      range,
    )
      .all()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getSessionsByStudent(student: string, range?: SessionRange) {
    return this.applyRange(
      SessionsModel.scan({
        student_id: { eq: student },
      }),
      range,
    )
      .all()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getAllSessions(range?: SessionRange) {
    return this.applyRange(SessionsModel.scan(), range)
      .all()
      .exec()
      .then((sessions) => {
        return sessions;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getSessionsBySeries(seriesId: string) {
    return SessionsModel.scan({
      series_id: { eq: seriesId },
    })
      .all()
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
      type: session.type,
      end_datetime: session.end_datetime,
      notes: session.notes,
      start_datetime: session.start_datetime,
      status: session.status,
      student_id: session.student_id,
      student_name: session.student_name,
      tutor_id: session.tutor_id,
      tutor_name: session.tutor_name,
      series_id: session.series_id,
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

  async createSessions(sessions: Session[]) {
    const prepared = sessions.map((session) => ({
      id: randomUUID(),
      type: session.type,
      end_datetime: session.end_datetime,
      notes: session.notes,
      start_datetime: session.start_datetime,
      status: session.status,
      student_id: session.student_id,
      student_name: session.student_name,
      tutor_id: session.tutor_id,
      tutor_name: session.tutor_name,
      series_id: session.series_id,
    }));

    // DynamoDB batchPut accepts at most 25 items per request.
    const chunks: (typeof prepared)[] = [];
    for (let i = 0; i < prepared.length; i += 25) {
      chunks.push(prepared.slice(i, i + 25));
    }

    return Promise.all(chunks.map((chunk) => SessionsModel.batchPut(chunk)))
      .then(() => {
        return Promise.resolve({
          ids: prepared.map((s) => s.id),
          count: prepared.length,
          message: 'Sessions created successfully.',
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
        type: session.type,
        end_datetime: session.end_datetime,
        notes: session.notes,
        start_datetime: session.start_datetime,
        status: session.status,
        student_id: session.student_id,
        student_name: session.student_name,
        tutor_id: session.tutor_id,
        tutor_name: session.tutor_name,
        series_id: session.series_id,
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
