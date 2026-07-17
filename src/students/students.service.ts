import { Injectable, Logger } from '@nestjs/common';
import { Student } from '../models/student.model';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { OnboardingRow } from '../models/onboarding-row.model';
import { STUDENT_STATUS } from './student-status';
import { randomUUID } from 'crypto';

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
    const makeUpBatches = Array.isArray(student.make_up_batches)
      ? student.make_up_batches.filter((b) => b && typeof b === 'object')
      : undefined;

    const candidate: Record<string, unknown> = {
      contact_id: student.contact_id,
      name: student.name,
      birthday: student.birthday,
      status: student.status,
      onboarding_complete: student.onboarding_complete,
      assigned_tutor_id: student.assigned_tutor_id,
      package: student.package,
      scholarship: student.scholarship,
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
      mid_month_prior_charge: student.mid_month_prior_charge,
      mid_month_change_period: student.mid_month_change_period,
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

  /** True when the client sent an explicitly empty make-up batch list (all consumed/expired). */
  private isMakeupBatchesCleared(student: Student): boolean {
    return (
      Array.isArray(student.make_up_batches) &&
      student.make_up_batches.length === 0
    );
  }

  async getStudent(id: string) {
    return StudentsModel.scan({
      id: { eq: id },
    })
      .all()
      .exec()
      .then((student) => {
        return student;
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

  async getStudentsByTutor(tutorId: string) {
    return StudentsModel.scan({
      assigned_tutor_id: { eq: tutorId },
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

      const contactIds = [
        ...new Set(students.map((s) => s.contact_id).filter(Boolean)),
      ];
      const contactsById = await this.getContactsByIds(contactIds);

      return students.map((student) =>
        this.buildOnboardingRow(student, contactsById.get(student.contact_id)),
      );
    } catch (error) {
      Logger.error((error as Error).message, error as Error);
      return Promise.reject(error as Error);
    }
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
  ): OnboardingRow {
    const contactName = contact
      ? `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
      : '';
    return {
      id: student.id,
      contact_id: student.contact_id,
      name: student.name,
      status: student.status,
      onboarding_complete: student.onboarding_complete ?? false,
      contact_name: contactName,
      inquiry_received: contact?.inquiry_received,
      inquiry_note_from_parent: contact?.inquiry_note_from_parent,
      consult_date: contact?.consult_date,
      trial_date: contact?.trial_date,
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
