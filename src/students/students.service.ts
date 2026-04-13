import { Injectable, Logger } from '@nestjs/common';
import { Student } from '../models/student.model';
import { StudentsModel } from '../models/students.model';
import { randomUUID } from 'crypto';

@Injectable()
export class StudentsService {
  async getStudent(id: string) {
    return StudentsModel.scan({
      id: { eq: id },
    })
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
      contact_id: student.contact_id,
      name: student.name,
      birthday: student.birthday,
      status: student.status,
      assigned_tutor_id: student.assigned_tutor_id,
      package: student.package,
      available_minutes: student.available_minutes,
      make_up_minutes: student.make_up_minutes,
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
    return StudentsModel.update(
      {
        id: student.id,
      },
      {
        contact_id: student.contact_id,
        name: student.name,
        birthday: student.birthday,
        status: student.status,
        assigned_tutor_id: student.assigned_tutor_id,
        package: student.package,
        available_minutes: student.available_minutes,
        make_up_minutes: student.make_up_minutes,
      },
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
