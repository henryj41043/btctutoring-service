import { Injectable, Logger } from '@nestjs/common';
import { ClientsModel } from '../models/clients.model';
import { Client } from '../models/client.model';

@Injectable()
export class ClientsService {
  async getClient(id: string) {
    return ClientsModel.scan({
      email: { eq: id },
    })
      .exec()
      .then((clients) => {
        return clients;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async getAllClients() {
    return ClientsModel.scan()
      .exec()
      .then((clients) => {
        return clients;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async createClient(client: Client) {
    const newClient = new ClientsModel({
      email: client.email,
      assigned_tutor: client.assigned_tutor,
      billing_cycle: client.billing_cycle,
      btc_and_me_enrolled: client.btc_and_me_enrolled,
      completed_sessions: client.completed_sessions,
      inquiry_date: client.inquiry_date,
      interview_scheduled: client.interview_scheduled,
      makeup_sessions: client.makeup_sessions,
      notes: client.notes,
      package: client.package,
      parent_name: client.parent_name,
      phone_number: client.phone_number,
      registration_received: client.registration_received,
      scholarship: client.scholarship,
      scholarship_name: client.scholarship_name,
      service: client.service,
      sessions: client.sessions,
      status: client.status,
      student_birthday: client.student_birthday,
      student_name: client.student_name,
    });
    return newClient
      .save()
      .then(() => {
        return Promise.resolve({
          id: client.email,
          message: 'Client created successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async updateClient(client: Client) {
    return ClientsModel.update(
      {
        email: client.email,
      },
      {
        assigned_tutor: client.assigned_tutor,
        billing_cycle: client.billing_cycle,
        btc_and_me_enrolled: client.btc_and_me_enrolled,
        completed_sessions: client.completed_sessions,
        inquiry_date: client.inquiry_date,
        interview_scheduled: client.interview_scheduled,
        makeup_sessions: client.makeup_sessions,
        notes: client.notes,
        package: client.package,
        parent_name: client.parent_name,
        phone_number: client.phone_number,
        registration_received: client.registration_received,
        scholarship: client.scholarship,
        scholarship_name: client.scholarship_name,
        service: client.service,
        sessions: client.sessions,
        status: client.status,
        student_birthday: client.student_birthday,
        student_name: client.student_name,
      },
    )
      .then((updatedClient) => {
        return updatedClient;
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }

  async deleteClient(id: string) {
    return ClientsModel.delete({
      email: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Client deleted successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }
}
