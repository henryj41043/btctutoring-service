import { Injectable, Logger } from '@nestjs/common';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { randomUUID } from 'crypto';

@Injectable()
export class ContactsService {
  async getContact(id: string) {
    return ContactsModel.scan({
      id: { eq: id },
    })
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async getContacts() {
    return ContactsModel.scan()
      .exec()
      .then((contacts) => {
        return contacts;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async createContact(contact: Contact) {
    const newUuid: string = randomUUID();
    const newContact = new ContactsModel({
      id: newUuid,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone_number: contact.phone_number,
      service: contact.service,
    });
    return newContact
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Contact created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async updateContact(contact: Contact) {
    return ContactsModel.update(
      {
        id: contact.id,
      },
      {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone_number: contact.phone_number,
        service: contact.service,
      },
    )
      .then((updatedContact) => {
        return updatedContact;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async deleteContact(id: string) {
    return ContactsModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Contact deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }
}
