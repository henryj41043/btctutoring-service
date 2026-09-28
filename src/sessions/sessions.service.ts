import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SessionsModel } from '../models/sessions.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { AttendanceChange, Session } from '../models/session.model';
import { User } from '../models/user.model';
import { isTutorLike } from '../models/user-groups';
import {
  ATTENDANCE_FINAL_MESSAGE,
  AttendancePlan,
  attendanceEffect,
  isFinalized,
  planAttendanceChange,
  SESSION_STATUS,
  SESSION_STATUSES,
  sessionMinutes,
} from './attendance';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { randomUUID } from 'crypto';
import { brandedEmail } from '../notifications/email-template';

/** PUT /sessions/:id/attendance payload. */
export class AttendanceRequest {
  status: string;
  /** Saved with the status when present (notes taken with attendance). */
  notes?: string;
  /** Required when an admin corrects attendance that was already taken. */
  reason?: string;
}

export interface AttendanceResult {
  session: Session;
  makeup: {
    before: number;
    after: number;
    delta: number;
    unrecovered: number;
  };
  /** True when nothing was written (the confirmation preview). */
  dry_run: boolean;
}

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
   * dialog when taking attendance). Sends the STORED notes — callers
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
    // Branded HTML (logo, brand colours) + a plain-text alternative built
    // from the same parts; the notes are escaped, line breaks preserved.
    const body = brandedEmail({
      title: `Session notes for ${studentName}`,
      greeting: `Hi ${contact.first_name || 'there'},`,
      intro:
        `Here are the notes from ${studentName}'s session on ${sessionDate}` +
        `${session.tutor_name ? ` with ${session.tutor_name}` : ''}:`,
      body: notes,
    });

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
            Body: body,
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
      participants: session.participants,
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
      participants: session.participants,
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
    const attributes: Record<string, unknown> = {
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
      participants: session.participants,
    };
    // Undefined values must not reach dynamoose: for the array-typed
    // `participants` it wraps the value into [undefined] and rejects the
    // whole update ("Expected participants.0 to be of type object") — which
    // broke every non-GROUP session edit.
    for (const key of Object.keys(attributes)) {
      if (attributes[key] === undefined) {
        delete attributes[key];
      }
    }
    return SessionsModel.update(
      {
        id: session.id,
      },
      attributes,
    )
      .then((updatedSession) => {
        return updatedSession;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  /**
   * Takes or corrects attendance — the ONE place a session's status changes
   * once it exists. The role is checked against the stored session, the
   * student's make-up minutes are corrected here (never in the browser),
   * and the change is recorded on the session.
   *
   * - Pending → anything: an admin, or the session's own tutor.
   * - Finalized → anything: an admin only, with a reason.
   */
  async setAttendance(
    id: string,
    request: AttendanceRequest,
    user: User,
    options: { dryRun?: boolean; now?: Date } = {},
  ): Promise<AttendanceResult> {
    const now = options.now ?? new Date();
    const status = request?.status;
    if (!status || !SESSION_STATUSES.includes(status)) {
      throw new BadRequestException(
        `status must be one of: ${SESSION_STATUSES.join(', ')}.`,
      );
    }
    const stored = await this.getSessionById(id);
    if (!stored) {
      throw new NotFoundException('Session not found.');
    }
    const groups = user.groups ?? [];
    const isAdmin = groups.includes('Admins');
    const ownsSession =
      isTutorLike(groups) && !!user.contact && stored.tutor_id === user.contact;
    if (!isAdmin && !ownsSession) {
      Logger.error('Invalid credentials for taking attendance');
      throw new ForbiddenException('Unauthorized');
    }
    const correcting = isFinalized(stored.status);
    if (correcting && !isAdmin) {
      throw new ForbiddenException(ATTENDANCE_FINAL_MESSAGE);
    }
    if ((stored.status ?? SESSION_STATUS.PENDING) === status) {
      throw new BadRequestException(`The session is already ${status}.`);
    }
    const reason = (request.reason ?? '').trim();
    if (correcting && !reason) {
      throw new BadRequestException(
        'A reason is required to change attendance that was already taken.',
      );
    }

    const student = stored.student_id
      ? ((await StudentsModel.get(stored.student_id).catch((err: Error) => {
          Logger.error(err.message, err);
          return Promise.reject(err);
        })) as unknown as Student | undefined)
      : undefined;
    const plan = planAttendanceChange(
      { ...stored },
      status,
      student ? ({ ...student } as Student) : undefined,
      now,
    );
    // Taking attendance on a make-up the student has no minutes for is
    // refused; a CORRECTION goes through and reports the shortfall.
    if (
      !correcting &&
      plan.unrecovered > 0 &&
      attendanceEffect(stored.type, status) === 'consume'
    ) {
      throw new BadRequestException(
        `Not enough make-up minutes. ${student?.name ?? 'The student'} has ${plan.before} min but this session requires ${sessionMinutes(stored)} min.`,
      );
    }

    const notes = typeof request.notes === 'string' ? request.notes : undefined;
    const makeup = {
      before: plan.before,
      after: plan.after,
      delta: plan.delta,
      unrecovered: plan.unrecovered,
    };
    if (options.dryRun) {
      return {
        session: {
          ...stored,
          status,
          ...(notes !== undefined ? { notes } : {}),
        },
        makeup,
        dry_run: true,
      };
    }

    const change: AttendanceChange = {
      from: stored.status ?? SESSION_STATUS.PENDING,
      to: status,
      by: user.contact ?? '',
      at: now.toISOString(),
      minutes_delta: plan.delta,
    };
    const byName = await this.displayNameOf(user);
    if (byName) change.by_name = byName;
    if (reason) change.reason = reason;
    if (plan.unrecovered > 0) change.unrecovered = plan.unrecovered;
    const history = [
      ...(stored.attendance_history ?? []).filter(
        (h) => !!h && typeof h === 'object',
      ),
      change,
    ];

    if (plan.student && student) {
      await this.writeLedger(student.id!, plan);
    }
    const attributes: Record<string, unknown> = {
      status,
      attendance_history: history,
    };
    if (notes !== undefined) attributes.notes = notes;
    const updated = await SessionsModel.update({ id }, attributes).catch(
      async (err: Error) => {
        Logger.error(err.message, err);
        // The minutes moved but the status did not: put the ledger back.
        if (plan.student && student) {
          await this.restoreLedger(student).catch((restoreErr: Error) => {
            Logger.error(
              `Could not restore the make-up ledger of ${student.id}: ${restoreErr.message}`,
              restoreErr,
            );
          });
        }
        return Promise.reject(err);
      },
    );
    return {
      session: updated as unknown as Session,
      makeup,
      dry_run: false,
    };
  }

  /** Writes the planned ledger onto the student (the two make-up fields only). */
  private async writeLedger(
    studentId: string,
    plan: AttendancePlan,
  ): Promise<void> {
    const batches = plan.student!.make_up_batches ?? [];
    const sets: Record<string, unknown> = {
      make_up_minutes: plan.student!.make_up_minutes ?? 0,
    };
    const update =
      batches.length > 0
        ? { ...sets, make_up_batches: batches }
        : { $SET: sets, $REMOVE: ['make_up_batches'] };
    await StudentsModel.update({ id: studentId }, update).catch(
      (err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      },
    );
  }

  /** Puts a student's make-up fields back as they were loaded. */
  private async restoreLedger(student: Student): Promise<void> {
    const batches = (student.make_up_batches ?? []).filter(
      (b) => !!b && typeof b === 'object',
    );
    const sets: Record<string, unknown> = {
      make_up_minutes: student.make_up_minutes ?? 0,
    };
    await StudentsModel.update(
      { id: student.id },
      batches.length > 0
        ? { ...sets, make_up_batches: batches }
        : { $SET: sets, $REMOVE: ['make_up_batches'] },
    );
  }

  /** The caller's name for the attendance record (blank when unknown). */
  private async displayNameOf(user: User): Promise<string> {
    if (!user.contact) return '';
    const contact = (await ContactsModel.get(user.contact).catch(
      () => undefined,
    )) as unknown as Contact | undefined;
    return contact
      ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
      : '';
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
