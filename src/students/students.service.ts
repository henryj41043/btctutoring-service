import { studentVisibleToTutor } from './student-visibility';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FirstWeekSession, Student } from '../models/student.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { OnboardingRow } from '../models/onboarding-row.model';
import { STUDENT_STATUS } from './student-status';
import { randomUUID } from 'crypto';
import {
  dateKey,
  easternDateKey,
  lastDayOfMonth,
} from '../billing/eastern-time';
import { HORIZON_MONTHS_AHEAD } from '../sessions/session-builder';
import {
  LEGACY_PENDING_FIELDS,
  applyPromotion,
  pendingChangesOf,
  sanitizePendingChanges,
  withNoticeSent,
} from './pending-changes';
import { PendingChange } from '../models/student.model';

/** The statuses a student may take once service has ended. */
export const END_STATUSES: string[] = [
  STUDENT_STATUS.PAST_STUDENT,
  STUDENT_STATUS.MIA,
  STUDENT_STATUS.DECLINED_SERVICES,
];

/** The start week: the start date and the six days after it. */
export const FIRST_WEEK_DAYS = 7;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A 'YYYY-MM-DD' key `days` later. */
function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Known keys only, no nested null/undefined (dynamoose rejects them). */
function sanitizeFirstWeekSessions(raw: unknown[]): FirstWeekSession[] {
  const clean: FirstWeekSession[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const session: FirstWeekSession = {
      date: entry.date as string,
      start_time: entry.start_time as string,
      end_time: entry.end_time as string,
    };
    if (typeof entry.tutor_id === 'string' && entry.tutor_id) {
      session.tutor_id = entry.tutor_id;
    }
    clean.push(session);
  }
  return clean.sort((a, b) =>
    `${a.date}${a.start_time}` < `${b.date}${b.start_time}` ? -1 : 1,
  );
}

/** Max keys per dynamoose batchGet request. */
const BATCH_GET_LIMIT = 100;

@Injectable()
export class StudentsService {
  /**
   * Builds the persistable attributes for a student, dropping null/undefined
   * values and any malformed schedule entries. dynamoose rejects `null` for
   * every typed field (string/number/boolean/array), and the client sends null
   * for the optional schedule/billing fields when saving a newly-added student,
   * so those must be stripped rather than written.
   */
  private buildStudentAttributes(student: Student): Record<string, unknown> {
    const schedule = Array.isArray(student.schedule)
      ? student.schedule.filter((s) => s && typeof s === 'object')
      : undefined;
    const pendingChanges = Array.isArray(student.pending_changes)
      ? sanitizePendingChanges(student.pending_changes)
      : undefined;
    const makeUpBatches = Array.isArray(student.make_up_batches)
      ? student.make_up_batches.filter((b) => b && typeof b === 'object')
      : undefined;
    const planningOverrides = Array.isArray(student.extra_planning_by_tutor)
      ? student.extra_planning_by_tutor.filter(
          (o) => o && typeof o === 'object',
        )
      : undefined;

    const firstWeek = Array.isArray(student.first_week_sessions)
      ? sanitizeFirstWeekSessions(student.first_week_sessions)
      : undefined;

    const candidate: Record<string, unknown> = {
      contact_id: student.contact_id,
      name: student.name,
      birthday: student.birthday,
      trial_date: student.trial_date,
      status: student.status,
      onboarding_complete: student.onboarding_complete,
      assigned_tutor_id: student.assigned_tutor_id,
      package: student.package,
      scholarship: student.scholarship,
      btc_and_me: student.btc_and_me,
      schedule: schedule && schedule.length > 0 ? schedule : undefined,
      package_start_date: student.package_start_date,
      auto_renew: student.auto_renew,
      custom_monthly_cost: student.custom_monthly_cost,
      custom_sessions_per_week: student.custom_sessions_per_week,
      custom_session_length_min: student.custom_session_length_min,
      make_up_minutes: student.make_up_minutes,
      make_up_batches:
        makeUpBatches && makeUpBatches.length > 0 ? makeUpBatches : undefined,
      make_up_never_expire: student.make_up_never_expire,
      extra_planning_minutes: student.extra_planning_minutes,
      extra_planning_by_tutor:
        planningOverrides && planningOverrides.length > 0
          ? planningOverrides
          : undefined,
      mid_month_prior_charge: student.mid_month_prior_charge,
      mid_month_change_period: student.mid_month_change_period,
      first_week_sessions:
        firstWeek && firstWeek.length > 0 ? firstWeek : undefined,
      service_end_date: student.service_end_date,
      // The end status only means something alongside an end date.
      end_status: student.service_end_date ? student.end_status : undefined,
      price_override: student.price_override,
      // A 0% discount is no discount: never stored.
      discount_percent: student.discount_percent || undefined,
      discount_reason: this.discountReasonOf(student),
      // The legacy pending_* scalars are never written again (see
      // pendingChangesRequested) — only the list.
      pending_changes:
        pendingChanges && pendingChanges.length > 0
          ? pendingChanges
          : undefined,
    };

    for (const key of Object.keys(candidate)) {
      if (candidate[key] === null || candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return candidate;
  }

  /** The trimmed discount reason, kept only alongside a discount. */
  private discountReasonOf(student: Student): string | undefined {
    if (!student.discount_percent) return undefined;
    const reason =
      typeof student.discount_reason === 'string'
        ? student.discount_reason.trim()
        : '';
    return reason || undefined;
  }

  /**
   * Rejects a malformed custom price or discount before anything is written
   * (null = clear, undefined = leave alone). Billing reads these directly.
   */
  private assertPricing(student: Student): void {
    const price: unknown = student.price_override;
    if (
      price !== undefined &&
      price !== null &&
      (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
    ) {
      throw new BadRequestException(
        'price_override must be a non-negative number, or null to clear.',
      );
    }
    const percent: unknown = student.discount_percent;
    if (
      percent !== undefined &&
      percent !== null &&
      (typeof percent !== 'number' ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100)
    ) {
      throw new BadRequestException(
        'discount_percent must be between 0 and 100, or null to clear.',
      );
    }
  }

  /**
   * Rejects a malformed service end date or end status before anything is
   * written (null = clear, undefined = leave alone).
   */
  private assertServiceEnd(student: Student): void {
    const end: unknown = student.service_end_date;
    if (
      end !== undefined &&
      end !== null &&
      (typeof end !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
        isNaN(Date.parse(`${end}T00:00:00Z`)))
    ) {
      throw new BadRequestException(
        'service_end_date must be formatted YYYY-MM-DD, or null to clear.',
      );
    }
    const status: unknown = student.end_status;
    if (
      status !== undefined &&
      status !== null &&
      !END_STATUSES.includes(status as string)
    ) {
      throw new BadRequestException(
        `end_status must be one of: ${END_STATUSES.join(', ')}.`,
      );
    }
  }

  /**
   * Validates a scheduled-change list before anything is written: real,
   * unique dates and sane prices. A date that is not already stored must
   * be in the future (Eastern) and inside the calendar look-ahead.
   */
  private async assertPendingChanges(
    student: Student,
    now: Date,
  ): Promise<void> {
    if (
      !Array.isArray(student.pending_changes) ||
      student.pending_changes.length === 0
    ) {
      return;
    }
    const changes = sanitizePendingChanges(student.pending_changes);
    const seen = new Set<string>();
    for (const change of changes) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(change.effective) ||
        isNaN(Date.parse(`${change.effective}T00:00:00Z`))
      ) {
        throw new BadRequestException(
          'A scheduled change date must be formatted YYYY-MM-DD.',
        );
      }
      if (seen.has(change.effective)) {
        throw new BadRequestException(
          'Two scheduled changes share the same date.',
        );
      }
      seen.add(change.effective);
    }
    for (const raw of student.pending_changes as unknown[]) {
      const price = (raw as { price_override?: unknown } | null)
        ?.price_override;
      if (
        price !== undefined &&
        price !== null &&
        (typeof price !== 'number' || !Number.isFinite(price) || price < 0)
      ) {
        throw new BadRequestException(
          "A scheduled change's price_override must be a non-negative number.",
        );
      }
    }

    const stored = student.id
      ? ((await StudentsModel.get(student.id).catch(() => undefined)) as
          | Student
          | undefined)
      : undefined;
    const storedDates = new Set(
      stored ? pendingChangesOf(stored).map((c) => c.effective) : [],
    );
    const today = easternDateKey(now);
    const [year, month] = today.split('-').map(Number);
    const latest = lastDayOfMonth(year, month - 1 + HORIZON_MONTHS_AHEAD);
    for (const change of changes) {
      if (storedDates.has(change.effective)) continue;
      if (change.effective <= today) {
        throw new BadRequestException(
          'A scheduled change must take effect on a future date.',
        );
      }
      if (change.effective > latest) {
        throw new BadRequestException(
          `A scheduled change can be set no later than ${latest}.`,
        );
      }
    }
  }

  /**
   * Rejects malformed first-week sessions before anything is written: a
   * real date inside the start week (the start date and the six days after
   * it) and an end time after the start time.
   */
  private assertFirstWeekSessions(student: Student): void {
    if (!Array.isArray(student.first_week_sessions)) return;
    const start = (student.package_start_date ?? '').slice(0, 10);
    const weekEnd = start ? addDays(start, FIRST_WEEK_DAYS - 1) : '';
    for (const raw of student.first_week_sessions as unknown[]) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const date = entry.date;
      if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        isNaN(Date.parse(`${date}T00:00:00Z`))
      ) {
        throw new BadRequestException(
          'A first-week session date must be formatted YYYY-MM-DD.',
        );
      }
      const startTime = entry.start_time;
      const endTime = entry.end_time;
      if (
        typeof startTime !== 'string' ||
        typeof endTime !== 'string' ||
        !TIME_PATTERN.test(startTime) ||
        !TIME_PATTERN.test(endTime) ||
        endTime <= startTime
      ) {
        throw new BadRequestException(
          'A first-week session needs a start time and a later end time (HH:mm).',
        );
      }
      if (start && (date < start || date > weekEnd)) {
        throw new BadRequestException(
          `A first-week session must fall between ${start} and ${weekEnd}.`,
        );
      }
    }
  }

  /** A null end date clears it together with its end status. */
  private serviceEndRemovals(student: Student): string[] {
    if (student.service_end_date === null) {
      return ['service_end_date', 'end_status'];
    }
    return student.end_status === null ? ['end_status'] : [];
  }

  /**
   * The pricing attributes an update must $REMOVE: a null custom price, a
   * null or 0% discount, and the reason whenever the discount goes or the
   * reason itself is blanked.
   */
  private pricingRemovals(student: Student): string[] {
    const remove: string[] = [];
    if (student.price_override === null) remove.push('price_override');
    const percent: unknown = student.discount_percent;
    const discountCleared = percent === null || percent === 0;
    if (discountCleared) remove.push('discount_percent');
    const reason: unknown = student.discount_reason;
    const reasonBlanked =
      reason === null || (typeof reason === 'string' && reason.trim() === '');
    if (discountCleared || (percent !== undefined && reasonBlanked)) {
      remove.push('discount_reason');
    }
    return remove;
  }

  /** True when the client sent an explicitly empty schedule, signalling a clear. */
  private isScheduleCleared(student: Student): boolean {
    return Array.isArray(student.schedule) && student.schedule.length === 0;
  }

  /**
   * The scheduled-change list the client wants stored, or undefined to leave
   * the attribute alone. Accepts the list itself ([] = clear all), plus the
   * two legacy single-change signals an older app build still sends: '' =
   * clear, and a filled scalar pair = a one-entry list.
   */
  private pendingChangesRequested(
    student: Student,
  ): PendingChange[] | undefined {
    if (Array.isArray(student.pending_changes)) {
      return sanitizePendingChanges(student.pending_changes);
    }
    if (student.pending_package === '') return [];
    if (student.pending_package && student.pending_package_effective) {
      return pendingChangesOf(student);
    }
    return undefined;
  }

  /** True when the client sent an explicitly empty make-up batch list (all consumed/expired). */
  private isMakeupBatchesCleared(student: Student): boolean {
    return (
      Array.isArray(student.make_up_batches) &&
      student.make_up_batches.length === 0
    );
  }

  async getStudent(id: string) {
    // Keyed GetItem; array-of-one preserves the old scan-result shape.
    return StudentsModel.get(id)
      .then((student) => {
        return student ? [student] : [];
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getStudentsByContact(contactId: string) {
    return StudentsModel.scan({
      contact_id: { eq: contactId },
    })
      .all()
      .exec()
      .then((students) => {
        return students;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * A student is visible to tutor T iff T is their primary (assigned) tutor
   * OR any live schedule slot names T as its per-slot tutor. The old filtered
   * scan was already a full-table scan, so filtering in code costs the same.
   * Public: the controller also uses it to scope a tutor's make-up write.
   */
  isVisibleToTutor(student: Student, tutorId: string): boolean {
    return studentVisibleToTutor(student, tutorId);
  }

  async getStudentsByTutor(tutorId: string) {
    return StudentsModel.scan()
      .all()
      .exec()
      .then((students) => {
        return (students as unknown as Student[]).filter((s) =>
          this.isVisibleToTutor(s, tutorId),
        );
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getStudents() {
    return StudentsModel.scan()
      .all()
      .exec()
      .then((students) => {
        return students;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Denormalized rows for the Onboarding page: every student in `Onboarding`
   * status joined to its family's name and onboarding dates. Filtering and the
   * join both happen server-side so the client gets one small payload.
   */
  async getOnboardingStudents(): Promise<OnboardingRow[]> {
    try {
      const students = (await StudentsModel.scan({
        status: { eq: STUDENT_STATUS.ONBOARDING },
      })
        .all()
        .exec()) as unknown as Student[];

      // One combined batchGet covers family contacts AND assigned tutors.
      const contactIds = [
        ...new Set(
          [
            ...students.map((s) => s.contact_id),
            ...students.map((s) => s.assigned_tutor_id),
          ].filter(Boolean),
        ),
      ];
      const contactsById = await this.getContactsByIds(contactIds);

      return students.map((student) =>
        this.buildOnboardingRow(
          student,
          contactsById.get(student.contact_id),
          student.assigned_tutor_id
            ? contactsById.get(student.assigned_tutor_id)
            : undefined,
        ),
      );
    } catch (error) {
      Logger.error((error as Error).message, error as Error);
      return Promise.reject(error as Error);
    }
  }

  /**
   * Denormalizes each student with their family's (contact's) display name
   * and email so list views (e.g. the roster) can show a Parent column and
   * copy caseload emails without a client-side join. Authz-safe by
   * construction: callers only ever pass students the requester may see.
   */
  async withContactNames(
    students: Student[],
  ): Promise<(Student & { contact_name: string; contact_email: string })[]> {
    const contactIds = [
      ...new Set(students.map((s) => s.contact_id).filter(Boolean)),
    ];
    const contactsById = await this.getContactsByIds(contactIds);
    return students.map((student) => {
      const contact = contactsById.get(student.contact_id);
      const contactName = contact
        ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
        : '';
      return Object.assign({}, student, {
        contact_name: contactName,
        contact_email: contact?.email ?? '',
      });
    });
  }

  /** Batch-fetch contacts by id (chunked to dynamoose's 100-key batchGet limit). */
  private async getContactsByIds(ids: string[]): Promise<Map<string, Contact>> {
    const byId = new Map<string, Contact>();
    for (let i = 0; i < ids.length; i += BATCH_GET_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_GET_LIMIT);
      const contacts = (await ContactsModel.batchGet(
        chunk,
      )) as unknown as Contact[];
      for (const contact of contacts) {
        if (contact && contact.id) {
          byId.set(contact.id, contact);
        }
      }
    }
    return byId;
  }

  /** Merge a student with its family's name + onboarding dates into a table row. */
  private buildOnboardingRow(
    student: Student,
    contact?: Contact,
    tutor?: Contact,
  ): OnboardingRow {
    const contactName = contact
      ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
      : '';
    const tutorName = tutor
      ? `${tutor.first_name ?? ''} ${tutor.last_name ?? ''}`.trim()
      : '';
    return {
      id: student.id,
      contact_id: student.contact_id,
      name: student.name,
      status: student.status,
      onboarding_complete: student.onboarding_complete ?? false,
      contact_name: contactName,
      tutor_name: tutorName,
      inquiry_received: contact?.inquiry_received,
      inquiry_note_from_parent: contact?.inquiry_note_from_parent,
      consult_date: contact?.consult_date,
      // Per-student date (2026-08) wins; legacy contact-level date as fallback.
      trial_date: student.trial_date ?? contact?.trial_date,
      registration_sent: contact?.registration_sent,
      registration_received: contact?.registration_received,
      scholarship_name: contact?.scholarship_name,
      scholarship_student: contact?.scholarship_student,
      twenty_five_received: contact?.twenty_five_received,
    };
  }

  async createStudent(student: Student, now: Date = new Date()) {
    this.assertPricing(student);
    this.assertServiceEnd(student);
    this.assertFirstWeekSessions(student);
    await this.assertPendingChanges(student, now);
    const newUuid: string = randomUUID();
    const attributes = this.buildStudentAttributes(student);
    // New students start in onboarding: the client only supplies a name, so
    // default the two lifecycle fields here as a safety net.
    if (attributes.status === undefined) {
      attributes.status = STUDENT_STATUS.ONBOARDING;
    }
    if (attributes.onboarding_complete === undefined) {
      attributes.onboarding_complete = false;
    }
    const newStudent = new StudentsModel({
      id: newUuid,
      ...attributes,
    });
    return newStudent
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Student created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async updateStudent(student: Student, now: Date = new Date()) {
    this.assertPricing(student);
    this.assertServiceEnd(student);
    this.assertFirstWeekSessions(student);
    await this.assertPendingChanges(student, now);
    const attributes = this.buildStudentAttributes(student);
    // An explicitly empty schedule/batch list means "clear it". dynamoose only
    // $SETs provided keys (and buildStudentAttributes drops empty arrays), so an
    // empty array would otherwise leave the old value in place — issue an
    // explicit $REMOVE to actually drop it.
    const remove: string[] = [];
    if (this.isScheduleCleared(student)) remove.push('schedule');
    if (this.isMakeupBatchesCleared(student)) remove.push('make_up_batches');
    if (
      Array.isArray(student.extra_planning_by_tutor) &&
      student.extra_planning_by_tutor.length === 0
    ) {
      remove.push('extra_planning_by_tutor');
    }
    remove.push(...this.pricingRemovals(student));
    remove.push(...this.serviceEndRemovals(student));
    if (
      Array.isArray(student.first_week_sessions) &&
      student.first_week_sessions.length === 0
    ) {
      remove.push('first_week_sessions');
    }
    const requested = this.pendingChangesRequested(student);
    if (requested !== undefined) {
      // Any pending write converges the record on the list: the legacy
      // scalars always leave (a $REMOVE of an absent path is a no-op), and
      // an empty list removes the attribute outright. Nothing may sit in
      // both $SET and $REMOVE (DynamoDB rejects overlapping paths).
      for (const field of LEGACY_PENDING_FIELDS) {
        remove.push(field);
        delete attributes[field];
      }
      if (requested.length === 0) {
        remove.push('pending_changes');
        delete attributes.pending_changes;
      } else {
        attributes.pending_changes = requested;
      }
    }
    const update =
      remove.length > 0 ? { $SET: attributes, $REMOVE: remove } : attributes;
    return StudentsModel.update(
      {
        id: student.id,
      },
      update,
    )
      .then((updatedStudent) => {
        return updatedStudent;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * Stamps the effective date a change's advance-notice email went out for,
   * so the daily cron never notifies twice for the same change. Rewrites the
   * whole list (stamp lives on the entry) from the student as loaded, and
   * converges a legacy record on the list while at it. Cron-only.
   */
  async markPendingChangeNoticeSent(
    student: Student,
    effective: string,
  ): Promise<void> {
    await StudentsModel.update(
      { id: student.id },
      {
        $SET: {
          pending_changes: withNoticeSent(pendingChangesOf(student), effective),
        },
        $REMOVE: [...LEGACY_PENDING_FIELDS],
      },
    ).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    });
  }

  /**
   * Applies every scheduled change due on or before `dayKey` ('YYYY-MM-DD')
   * in one write (see applyPromotion): the closed package goes to
   * package_history and the last due change becomes current. No-op when
   * nothing is due. Called by the daily and the 1st-of-month jobs.
   */
  async promotePendingChanges(student: Student, dayKey: string): Promise<void> {
    const result = applyPromotion(student, dayKey);
    if (!result) return;
    await StudentsModel.update(
      { id: student.id },
      { $SET: result.sets, $REMOVE: result.removes },
    ).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    });
  }

  /**
   * Moves a student whose service has ended to their end status (Past
   * Student unless the admin chose another). Daily-job only: touches the
   * status and nothing else.
   */
  async applyServiceEnd(student: Student): Promise<string> {
    const status =
      student.end_status && END_STATUSES.includes(student.end_status)
        ? student.end_status
        : STUDENT_STATUS.PAST_STUDENT;
    await StudentsModel.update({ id: student.id }, { status }).catch(
      (error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      },
    );
    return status;
  }

  async deleteStudent(id: string) {
    return StudentsModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Student deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
