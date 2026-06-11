import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { User } from '../models/user.model';
import { Contact } from '../models/contact.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'contact-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'contact-tutor',
};

const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const contact = { id: 'contact-1', first_name: 'Ada' } as Contact;

describe('ContactsController', () => {
  let controller: ContactsController;
  let service: jest.Mocked<ContactsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<ContactsService>> = {
      getContact: jest.fn(),
      getContacts: jest.fn(),
      createContact: jest.fn(),
      updateContact: jest.fn(),
      deleteContact: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(ContactsController);
    service = module.get(ContactsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getContacts', () => {
    it('admin with id fetches a single contact', async () => {
      service.getContact.mockResolvedValue([contact] as never);
      await controller.getContacts(reqAs(admin), 'contact-1');
      expect(service.getContact).toHaveBeenCalledWith('contact-1');
    });

    it('admin without id lists all contacts', async () => {
      service.getContacts.mockResolvedValue([contact] as never);
      await controller.getContacts(reqAs(admin), '');
      expect(service.getContacts).toHaveBeenCalled();
    });

    it('non-admin may fetch their own contact', async () => {
      service.getContact.mockResolvedValue([contact] as never);
      await controller.getContacts(reqAs(tutor), 'contact-tutor');
      expect(service.getContact).toHaveBeenCalledWith('contact-tutor');
    });

    it('non-admin requesting another contact is unauthorized', async () => {
      await expect(
        controller.getContacts(reqAs(tutor), 'contact-1'),
      ).rejects.toThrow('Unauthorized');
      expect(service.getContact).not.toHaveBeenCalled();
    });

    it('non-admin without id is unauthorized', async () => {
      await expect(controller.getContacts(reqAs(tutor), '')).rejects.toThrow(
        'Unauthorized',
      );
    });

    it('treats a missing groups array as non-admin', async () => {
      const noGroups = { ...tutor, groups: undefined } as unknown as User;
      await expect(
        controller.getContacts(reqAs(noGroups), 'contact-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('createContact', () => {
    it('admin creates a contact', async () => {
      service.createContact.mockResolvedValue({
        id: 'x',
        message: 'ok',
      } as never);
      await controller.createContact(reqAs(admin), contact);
      expect(service.createContact).toHaveBeenCalledWith(contact);
    });

    it('non-admin is unauthorized', async () => {
      await expect(
        controller.createContact(reqAs(tutor), contact),
      ).rejects.toThrow('Unauthorized');
      expect(service.createContact).not.toHaveBeenCalled();
    });

    it('treats a missing groups array as non-admin', async () => {
      const noGroups = { ...tutor, groups: undefined } as unknown as User;
      await expect(
        controller.createContact(reqAs(noGroups), contact),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('updateContact', () => {
    it('admin updates a contact', async () => {
      service.updateContact.mockResolvedValue(contact as never);
      await controller.updateContact(reqAs(admin), contact);
      expect(service.updateContact).toHaveBeenCalledWith(contact);
    });

    it('non-admin is unauthorized', async () => {
      await expect(
        controller.updateContact(reqAs(tutor), contact),
      ).rejects.toThrow('Unauthorized');
    });

    it('treats a missing groups array as non-admin', async () => {
      const noGroups = { ...tutor, groups: undefined } as unknown as User;
      await expect(
        controller.updateContact(reqAs(noGroups), contact),
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('deleteContact', () => {
    it('admin deletes a contact', async () => {
      service.deleteContact.mockResolvedValue({
        id: 'contact-1',
        message: 'ok',
      } as never);
      await controller.deleteContact(reqAs(admin), 'contact-1');
      expect(service.deleteContact).toHaveBeenCalledWith('contact-1');
    });

    it('non-admin is unauthorized', async () => {
      await expect(
        controller.deleteContact(reqAs(tutor), 'contact-1'),
      ).rejects.toThrow('Unauthorized');
    });

    it('treats a missing groups array as non-admin', async () => {
      const noGroups = { ...tutor, groups: undefined } as unknown as User;
      await expect(
        controller.deleteContact(reqAs(noGroups), 'contact-1'),
      ).rejects.toThrow('Unauthorized');
    });
  });
});
