import { Test, TestingModule } from '@nestjs/testing';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
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
    sibling_discount: 10,
    ...overrides,
  }) as Contact;

describe('ContactsService', () => {
  let service: ContactsService;
  const documentClient = { send: jest.fn() };

  beforeEach(async () => {
    documentClient.send.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: DynamoDBDocumentClient, useValue: documentClient },
      ],
    }).compile();
    service = module.get<ContactsService>(ContactsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getContact', () => {
    it('gets the contact by key and wraps it in an array', async () => {
      const contact = sampleContact();
      Model.get.mockResolvedValue(contact);

      await expect(service.getContact('contact-1')).resolves.toEqual([contact]);
      expect(Model.get).toHaveBeenCalledWith('contact-1');
    });

    it('returns an empty array when the contact does not exist', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.getContact('missing')).resolves.toEqual([]);
    });

    it('rejects when the get fails', async () => {
      Model.get.mockRejectedValue(new Error('get boom'));
      await expect(service.getContact('contact-1')).rejects.toThrow('get boom');
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

  describe('getContactsSummary', () => {
    it('scans with the summary projection via the raw document client', async () => {
      const lean = [{ id: 'c-1', first_name: 'Ada', email: 'ada@example.com' }];
      documentClient.send.mockResolvedValue({ Items: lean });
      await expect(service.getContactsSummary()).resolves.toEqual(lean);
      const cmd = documentClient.send.mock.calls.at(-1)![0] as {
        input: Record<string, unknown>;
      };
      expect(cmd.input.TableName).toBe('BTCTutoring-Contacts-Table');
      expect(cmd.input.ProjectionExpression).toBe(
        '#id, #fn, #ln, #em, #ph, #sv, #ug, #st',
      );
      expect(cmd.input.ExpressionAttributeNames).toEqual({
        '#id': 'id',
        '#fn': 'first_name',
        '#ln': 'last_name',
        '#em': 'email',
        '#ph': 'phone_number',
        '#sv': 'service',
        '#ug': 'user_group',
        '#st': 'status',
      });
      expect(cmd.input.ExclusiveStartKey).toBeUndefined();
    });

    it('follows LastEvaluatedKey across pages and concatenates items', async () => {
      documentClient.send
        .mockResolvedValueOnce({
          Items: [{ id: 'c-1' }],
          LastEvaluatedKey: { id: 'c-1' },
        })
        .mockResolvedValueOnce({ Items: [{ id: 'c-2' }] });
      await expect(service.getContactsSummary()).resolves.toEqual([
        { id: 'c-1' },
        { id: 'c-2' },
      ]);
      expect(documentClient.send).toHaveBeenCalledTimes(2);
      const second = documentClient.send.mock.calls.at(-1)![0] as {
        input: Record<string, unknown>;
      };
      expect(second.input.ExclusiveStartKey).toEqual({ id: 'c-1' });
    });

    it('tolerates a page with no Items array', async () => {
      documentClient.send.mockResolvedValue({});
      await expect(service.getContactsSummary()).resolves.toEqual([]);
    });

    it('rejects when the scan fails', async () => {
      documentClient.send.mockRejectedValue(new Error('scan boom'));
      await expect(service.getContactsSummary()).rejects.toThrow('scan boom');
    });
  });

  describe('getStaffContacts', () => {
    it('scans for Hiring staff only and paginates fully', async () => {
      const staff = [sampleContact({ service: 'Hiring', status: 'Staff' })];
      const chain = scanResolves(Model, staff);
      await expect(service.getStaffContacts()).resolves.toBe(staff);
      expect(Model.scan).toHaveBeenCalledWith({
        service: { eq: 'Hiring' },
        status: { eq: 'Staff' },
      });
      expect(chain.all).toHaveBeenCalled();
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getStaffContacts()).rejects.toThrow('scan boom');
    });
  });

  describe('getAdminContacts', () => {
    it('scans for Admins user_group and paginates fully', async () => {
      const admins = [sampleContact({ user_group: 'Admins' })];
      const chain = scanResolves(Model, admins);
      await expect(service.getAdminContacts()).resolves.toBe(admins);
      expect(Model.scan).toHaveBeenCalledWith({
        user_group: { eq: 'Admins' },
      });
      expect(chain.all).toHaveBeenCalled();
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getAdminContacts()).rejects.toThrow('scan boom');
    });
  });

  describe('createContact', () => {
    it('saves a new contact and returns a generated id', async () => {
      scanResolves(Model, []); // duplicate-email check finds nothing
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
          sibling_discount: 10,
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

    it('persists the hire type on create', async () => {
      scanResolves(Model, []);
      Model.__save.mockResolvedValue(undefined);

      await service.createContact(sampleContact({ hire_type: 'W2' }));

      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({ hire_type: 'W2' }),
      );
    });

    it('handles a contact without an availability list', async () => {
      scanResolves(Model, []);
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createContact(
        sampleContact({ availability: undefined }),
      );
      expect(result.message).toBe('Contact created successfully.');
    });

    it('rejects when save fails', async () => {
      scanResolves(Model, []);
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createContact(sampleContact())).rejects.toThrow(
        'save boom',
      );
    });
  });

  describe('createContact duplicate email', () => {
    it('rejects with a conflict when the email already exists', async () => {
      scanResolves(Model, [sampleContact()]); // ada@example.com taken
      await expect(
        service.createContact(sampleContact({ id: undefined })),
      ).rejects.toThrow('A contact with this email already exists.');
      expect(Model.__save).not.toHaveBeenCalled();
    });

    it('matches emails case-insensitively and ignoring whitespace', async () => {
      scanResolves(Model, [sampleContact({ email: 'Ada@Example.com ' })]);
      await expect(
        service.createContact(sampleContact({ email: '  ADA@example.COM' })),
      ).rejects.toThrow('A contact with this email already exists.');
    });

    it('creates when the email is unused', async () => {
      scanResolves(Model, [sampleContact({ email: 'other@example.com' })]);
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createContact(sampleContact());
      expect(result.message).toBe('Contact created successfully.');
    });

    it('skips the check when no email is provided', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createContact(
        sampleContact({ email: undefined }),
      );
      expect(Model.scan).not.toHaveBeenCalled();
      expect(result.message).toBe('Contact created successfully.');
    });
  });

  describe('updateContact', () => {
    it('updates and returns the contact', async () => {
      const updated = sampleContact({ first_name: 'Grace' });
      scanResolves(Model, []); // email-uniqueness check finds nothing
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
          sibling_discount: 10,
          availability: [
            { days: ['Tue'], start_time: '11:00', end_time: '12:00' },
          ],
        }),
      );
      expect(result).toBe(updated);
    });

    it("rejects an edit that collides with another contact's email", async () => {
      scanResolves(Model, [sampleContact({ id: 'other-contact' })]); // same email, different id
      await expect(
        service.updateContact(sampleContact({ id: 'contact-1' })),
      ).rejects.toThrow('A contact with this email already exists.');
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('lets a contact keep their own email on update', async () => {
      scanResolves(Model, [sampleContact({ id: 'contact-1' })]); // the record itself
      Model.update.mockResolvedValue(sampleContact());
      await expect(
        service.updateContact(sampleContact({ id: 'contact-1' })),
      ).resolves.toBeTruthy();
    });

    it('skips the uniqueness check when the payload has no email', async () => {
      Model.update.mockResolvedValue(sampleContact());
      await service.updateContact(sampleContact({ email: undefined }));
      expect(Model.scan).not.toHaveBeenCalled();
    });

    it('persists the hire type on update', async () => {
      scanResolves(Model, []);
      Model.update.mockResolvedValue(sampleContact());

      await service.updateContact(sampleContact({ hire_type: '1099' }));

      const payload = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect(payload['hire_type']).toBe('1099');
    });

    it('rejects when update fails', async () => {
      scanResolves(Model, []);
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateContact(sampleContact())).rejects.toThrow(
        'update boom',
      );
    });

    it('drops undefined fields so partial saves never erase stored values', async () => {
      scanResolves(Model, []);
      Model.update.mockResolvedValue(sampleContact());

      // A non-admin save omits disabled controls — status arrives undefined.
      await service.updateContact(
        sampleContact({
          status: undefined,
          hourly_rate: undefined,
          hire_type: undefined,
        }),
      );

      const payload = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect('status' in payload).toBe(false);
      expect('hourly_rate' in payload).toBe(false);
      expect('hire_type' in payload).toBe(false);
      expect(payload['first_name']).toBe('Ada');
    });

    it('passes empty strings through so deliberate clears still work', async () => {
      scanResolves(Model, []);
      Model.update.mockResolvedValue(sampleContact());

      await service.updateContact(sampleContact({ zoom_link: '' }));

      const payload = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect(payload['zoom_link']).toBe('');
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
