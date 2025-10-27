import { Injectable, Logger } from '@nestjs/common';
import { ClientsModel } from '../models/clients.model';
import { Client } from '../models/client.model';

@Injectable()
export class ClientsService {
  async getClient(id: string) {
    return ClientsModel.scan({
      client: { eq: id },
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
      client: client.client,
      duration: client.duration,
      makeupSessions: client.makeupSessions,
      sessions: client.sessions,
    });
    return newClient
      .save()
      .then(() => {
        return Promise.resolve({
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
        client: client.client,
      },
      {
        duration: client.duration,
        makeupSessions: client.makeupSessions,
        sessions: client.sessions,
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
      client: id,
    })
      .then(() => {
        return Promise.resolve({
          client: id,
          message: 'Client deleted successfully.',
        });
      })
      .catch((err: Error) => {
        Logger.error(err.message, err);
        return Promise.reject(err);
      });
  }
}
