import { Injectable, Logger } from '@nestjs/common';
import { Student } from '../models/student.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { OnboardingRow } from '../models/onboarding-row.model';
import { STUDENT_STATUS } from './student-status';
import { CUSTOM_PACKAGE } from '../billing/package-config';
import { randomUUID } from 'crypto';

/** Max keys per dynamoose batchGet request. */
const BATCH_GET_LIMIT = 100;

/** Every scheduled-package-change field, cleared together. */
const PENDING_FIELDS = [
  'pending_package',
  'pending_custom_monthly_cost',
  'pending_custom_sessions_per_week',
  'pending_custom_session_length_min',
  'pending_package_effective',
  'pending_schedule',
] as const;

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
    const pendingSchedule = Array.isArray(student.pending_schedule)
      ? student.pending_schedule.filter((s) => s && typeof s === 'object')
      : undefined;
    const makeUpBatches = Array.isArray(student.make_up_batches)
      ? student.make_up_batches.filter((b) => b && typeof b === 'object')
      : undefined;
    const planningOverrides = Array.isArray(student.extra_planning_by_tutor)
      ? student.extra_planning_by_tutor.filter((o) => o && typeof o === 'object')
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
      pending_package: student.pending_package,
      pending_custom_monthly_cost: student.pending_custom_monthly_cost,
      pending_custom_sessions_per_week:
        student.pending_custom_sessions_per_week,
      pending_custom_session_length_min:
        student.pending_custom_session_length_min,
      pending_package_effective: student.pending_package_effective,
      pending_schedule:
        pendingSchedule && pendingSchedule.length > 0
          ? pendingSchedule
          : undefined,
    };

    for (const key of Object.keys(candidate)) {
      if (candidate[key] === null || candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return candidate;
  }

  /** True when the client sent an explicitly empty schedule, signalling a clear. */
  private isScheduleCleared(student: Student): boolean {
    return Array.isArray(student.schedule) && student.schedule.length === 0;
  }

  /** True when the client sent an empty pending_package, signalling "clear the scheduled change". */
  private isPendingCleared(student: Student): boolean {
    return student.pending_package === '';
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
    return (
      student.assigned_tutor_id === tutorId ||
      (student.schedule ?? []).some((slot) => slot?.tutor_id === tutorId)
    );
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

  async createStudent(student: Student) {
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

  async updateStudent(student: Student) {
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
    if (this.isPendingCleared(student)) {
      // '' is a string, so it survives the null/undefined strip — the pending
      // keys must leave $SET too (DynamoDB rejects overlapping SET/REMOVE
      // paths in one update).
      for (const field of PENDING_FIELDS) {
        remove.push(field);
        delete attributes[field];
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
   * The ONLY student write a tutor may perform: the attendance-driven
   * make-up bank change (a cancelled session banks its minutes; a finalized
   * make-up consumes them). Least privilege — only the two make-up fields
   * are applied from the payload; everything else stays admin-only through
   * updateStudent.
   */
  async updateStudentMakeup(student: Student) {
    const batches = Array.isArray(student.make_up_batches)
      ? student.make_up_batches.filter((b) => b && typeof b === 'object')
      : undefined;
    const sets: Record<string, unknown> = {};
    if (typeof student.make_up_minutes === 'number') {
      sets.make_up_minutes = student.make_up_minutes;
    }
    if (batches && batches.length > 0) {
      sets.make_up_batches = batches;
    }
    // An explicitly empty batch list means "all consumed/expired" — clear it
    // (updateStudent precedent: $SET only writes provided keys).
    const remove: string[] = [];
    if (this.isMakeupBatchesCleared(student)) {
      remove.push('make_up_batches');
    }
    const update = remove.length > 0 ? { $SET: sets, $REMOVE: remove } : sets;
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
   * Applies a due scheduled package change to the stored student: the pending
   * package (and its CUSTOM overrides) becomes current, the pending schedule
   * (when defined) replaces the weekly slots, package_start_date becomes the
   * effective date, and every pending field is removed. Called by the
   * 1st-of-month cron; a direct model update because buildStudentAttributes
   * has no scalar-$REMOVE path.
   */
  async promotePendingPackage(student: Student): Promise<void> {
    const isCustom = student.pending_package === CUSTOM_PACKAGE;
    const sets: Record<string, unknown> = {
      package: student.pending_package,
      // Zoneless local-wall stamp (mid-month precedent): a bare 'YYYY-MM-DD'
      // parses as UTC midnight, which reads as the prior evening on an
      // Eastern browser and mis-prorates the effective month.
      package_start_date: `${student.pending_package_effective}T00:00:00`,
    };
    if (isCustom) {
      sets.custom_monthly_cost = student.pending_custom_monthly_cost;
      sets.custom_sessions_per_week = student.pending_custom_sessions_per_week;
      sets.custom_session_length_min =
        student.pending_custom_session_length_min;
    }
    if (student.pending_schedule && student.pending_schedule.length > 0) {
      sets.schedule = student.pending_schedule;
    }
    // dynamoose rejects undefined $SET values (an incomplete CUSTOM pending).
    for (const key of Object.keys(sets)) {
      if (sets[key] === undefined) delete sets[key];
    }
    const removes: string[] = [...PENDING_FIELDS];
    if (!isCustom) {
      // Stale overrides must not leak into a later switch to CUSTOM.
      removes.push(
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
      );
    }
    await StudentsModel.update(
      { id: student.id },
      { $SET: sets, $REMOVE: removes },
    ).catch((error: Error) => {
      Logger.error(error.message, error);
      return Promise.reject(error);
    });
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
