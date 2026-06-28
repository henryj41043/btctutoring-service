import { Test, TestingModule } from '@nestjs/testing';
import { ContactsService } from './contacts.service';
import { ContactsModel } from '../models/contacts.model';
import { Contact } from '../models/contact.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/contacts.model', () => ({
  ContactsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = ContactsModel as unknown as ModelMock;

const sampleContact = (overrides: Partial<Contact> = {}): Contact =>
  ({
    id: 'contact-1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone_number: '5551234567',
    service: 'Tutoring',
    ...overrides,
  }) as Contact;

describe('ContactsService', () => {
  let service: ContactsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContactsService],
    }).compile();
    service = module.get<ContactsService>(ContactsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getContact', () => {
    it('returns the scanned contact by id', async () => {
      const contacts = [sampleContact()];
      scanResolves(Model, contacts);

      await expect(service.getContact('contact-1')).resolves.toBe(contacts);
      expect(Model.scan).toHaveBeenCalledWith({ id: { eq: 'contact-1' } });
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getContact('contact-1')).rejects.toThrow(
        'scan boom',
      );
    });
  });

  describe('getContacts', () => {
    it('returns all scanned contacts', async () => {
      const contacts = [sampleContact(), sampleContact({ id: 'contact-2' })];
      scanResolves(Model, contacts);

      await expect(service.getContacts()).resolves.toBe(contacts);
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getContacts()).rejects.toThrow('scan boom');
    });
  });

  describe('createContact', () => {
    it('saves a new contact and returns a generated id', async () => {
      Model.__save.mockResolvedValue(undefined);

      const result = await service.createContact(
        sampleContact({
          availability: [
            { days: ['Mon'], start_time: '09:00', end_time: '10:00' },
          ],
        }),
      );

      expect(Model).toHaveBeenCalledTimes(1);
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Ada',
          availability: [
            { days: ['Mon'], start_time: '09:00', end_time: '10:00' },
          ],
        }),
      );
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Contact created successfully.',
      });
    });

    it('handles a contact without an availability list', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createContact(
        sampleContact({ availability: undefined }),
      );
      expect(result.message).toBe('Contact created successfully.');
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createContact(sampleContact())).rejects.toThrow(
        'save boom',
      );
    });
  });

  describe('updateContact', () => {
    it('updates and returns the contact', async () => {
      const updated = sampleContact({ first_name: 'Grace' });
      Model.update.mockResolvedValue(updated);

      const result = await service.updateContact(
        sampleContact({
          availability: [
            { days: ['Tue'], start_time: '11:00', end_time: '12:00' },
          ],
        }),
      );

      expect(Model.update).toHaveBeenCalledWith(
        { id: 'contact-1' },
        expect.objectContaining({
          first_name: 'Ada',
          availability: [
            { days: ['Tue'], start_time: '11:00', end_time: '12:00' },
          ],
        }),
      );
      expect(result).toBe(updated);
    });

    it('rejects when update fails', async () => {
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateContact(sampleContact())).rejects.toThrow(
        'update boom',
      );
    });
  });

  describe('deleteContact', () => {
    it('deletes the contact and returns a confirmation', async () => {
      Model.delete.mockResolvedValue(undefined);

      await expect(service.deleteContact('contact-1')).resolves.toEqual({
        id: 'contact-1',
        message: 'Contact deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'contact-1' });
    });

    it('rejects when delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteContact('contact-1')).rejects.toThrow(
        'delete boom',
      );
    });
  });
});
