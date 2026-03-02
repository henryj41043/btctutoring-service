import { Injectable, Logger } from '@nestjs/common';
import { EmployeesModel } from '../models/employees.model';
import { Employee } from '../models/employee.model';

@Injectable()
export class EmployeesService {
  async getEmployee(id: string) {
    return EmployeesModel.scan({
      email: { eq: id },
    })
      .exec()
      .then((employees) => {
        return employees;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getAllEmployees() {
    return EmployeesModel.scan()
      .exec()
      .then((employees) => {
        return employees;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async createEmployee(employee: Employee) {
    const newEmployee = new EmployeesModel({
      email: employee.email,
      first_name: employee.first_name,
      last_name: employee.last_name,
      phone_number: employee.phone_number,
      group: employee.group,
      status: employee.status,
      service: employee.service,
      notes: employee.notes,
      interview_scheduled: employee.interview_scheduled,
    });
    return newEmployee
      .save()
      .then(() => {
        return Promise.resolve({
          id: employee.email,
          message: 'Employee created successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async updateEmployee(employee: Employee) {
    return EmployeesModel.update(
      {
        email: employee.email,
      },
      {
        first_name: employee.first_name,
        last_name: employee.last_name,
        phone_number: employee.phone_number,
        group: employee.group,
        status: employee.status,
        service: employee.service,
        notes: employee.notes,
        interview_scheduled: employee.interview_scheduled,
      },
    )
      .then((updatedEmployee) => {
        return updatedEmployee;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async deleteEmployee(id: string) {
    return EmployeesModel.delete({
      email: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Employee deleted successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }
}
