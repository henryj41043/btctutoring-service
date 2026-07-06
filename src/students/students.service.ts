import { Injectable, Logger } from '@nestjs/common';
import { Student } from '../models/student.model';
import { StudentsModel } from '../models/students.model';
import { randomUUID } from 'crypto';

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

    const candidate: Record<string, unknown> = {
      contact_id: student.contact_id,
      name: student.name,
      birthday: student.birthday,
      status: student.status,
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

  async createStudent(student: Student) {
    const newUuid: string = randomUUID();
    const newStudent = new StudentsModel({
      id: newUuid,
      ...this.buildStudentAttributes(student),
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
    // An explicitly empty schedule means "clear the recurring schedule". dynamoose
    // only $SETs provided keys (and buildStudentAttributes drops empty arrays), so
    // an empty array would otherwise leave the old schedule in place — issue an
    // explicit $REMOVE to actually drop it.
    const update = this.isScheduleCleared(student)
      ? { $SET: attributes, $REMOVE: ['schedule'] }
      : attributes;
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
