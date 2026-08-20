import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SessionsModel } from '../models/sessions.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Session } from '../models/session.model';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { randomUUID } from 'crypto';

/** Optional start_datetime range (ISO strings; ISO sorts lexically). */
export interface SessionRange {
  from?: string;
  to?: string;
}

@Injectable()
export class SessionsService {
  private readonly ses = new SESClient({
    region: process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });

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

  /**
   * Emails the session's notes to the student's parent (opt-in from the
   * dialog after attendance is completed). Sends the STORED notes — callers
   * persist their edit first, then request the send. Stamps notes_emailed_at
   * for display, but deliberate re-sends are allowed (a tutor may amend the
   * notes and email again).
   */
  async emailSessionNotes(id: string) {
    // Fail closed before any lookups — a config gap reads as a 500, not a
    // half-done send.
    const fromEmail = process.env.SES_FROM_EMAIL;
    if (!fromEmail) {
      Logger.error('SES_FROM_EMAIL is not set — cannot email session notes.');
      throw new InternalServerErrorException('Email sending is not configured');
    }
    const session = await this.getSessionById(id);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const notes = (session.notes ?? '').trim();
    if (!notes) {
      throw new BadRequestException('This session has no notes to email.');
    }
    if (!session.student_id) {
      throw new BadRequestException('This session has no student.');
    }
    const student = (await StudentsModel.get(session.student_id).catch(
      (err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      },
    )) as unknown as Student | undefined;
    if (!student?.contact_id) {
      throw new NotFoundException('No family contact for this student.');
    }
    const contact = (await ContactsModel.get(student.contact_id).catch(
      (err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      },
    )) as unknown as Contact | undefined;
    if (!contact?.email) {
      throw new NotFoundException('The family contact has no email address.');
    }

    const studentName = session.student_name || student.name || 'your student';
    const sessionDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(session.start_datetime));
    const body = [
      `Hi ${contact.first_name || 'there'},`,
      ``,
      `Here are the notes from ${studentName}'s session on ${sessionDate}` +
        `${session.tutor_name ? ` with ${session.tutor_name}` : ''}:`,
      ``,
      notes,
      ``,
      `— Beyond the Chalkboard Tutoring`,
    ].join('\n');

    await this.ses
      .send(
        new SendEmailCommand({
          Source: fromEmail,
          Destination: { ToAddresses: [contact.email] },
          Message: {
            Subject: {
              Data: `Session notes for ${studentName} — ${sessionDate}`,
              Charset: 'UTF-8',
            },
            Body: { Text: { Data: body, Charset: 'UTF-8' } },
          },
        }),
      )
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });

    // Best-effort stamp: the email is already out, so a failed write only
    // costs the display hint — never fail the request over it.
    const now = new Date().toISOString();
    await SessionsModel.update({ id }, { notes_emailed_at: now }).catch(
      (err: Error) =>
        Logger.error(`Failed to stamp notes_emailed_at: ${err.message}`, err),
    );
    return { id, message: 'Session notes emailed.', notes_emailed_at: now };
  }

  /** Keyed GetItem for one session, or undefined when the id is unknown. */
  async getSessionById(id: string): Promise<Session | undefined> {
    return SessionsModel.get(id)
      .then((session) => {
        return session as unknown as Session | undefined;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
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
