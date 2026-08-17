import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import express from 'express';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { User } from '../models/user.model';
import { EmailEntry } from '../models/email-entry.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};
const groupless: User = {
  username: 'nogroups',
  email: 'nogroups@example.com',
  groups: undefined as unknown as string[],
  contact: 'c-nogroups',
};

const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const emailEntry = { id: 'hash-1', subject: 'Hi' } as EmailEntry;

describe('EmailsController', () => {
  let controller: EmailsController;
  let service: jest.Mocked<EmailsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<EmailsService>> = {
      getEmailsByContact: jest.fn(),
      getUnmatchedEmails: jest.fn(),
      assignEmail: jest.fn(),
      discardEmail: jest.fn(),
      getOriginalUrl: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailsController],
      providers: [{ provide: EmailsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(EmailsController);
    service = module.get(EmailsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('as an admin', () => {
    it("lists a contact's emails", async () => {
      service.getEmailsByContact.mockResolvedValue([emailEntry]);
      await expect(
        controller.getEmailsByContact(reqAs(admin), 'c-1'),
      ).resolves.toEqual([emailEntry]);
      expect(service.getEmailsByContact).toHaveBeenCalledWith('c-1');
    });

    it('lists the unmatched queue', async () => {
      service.getUnmatchedEmails.mockResolvedValue([emailEntry]);
      await expect(
        controller.getUnmatchedEmails(reqAs(admin)),
      ).resolves.toEqual([emailEntry]);
    });

    it("assigns with the acting admin's username", async () => {
      service.assignEmail.mockResolvedValue(emailEntry as never);
      await controller.assignEmail(reqAs(admin), 'hash-1', {
        contact_id: 'c-9',
      });
      expect(service.assignEmail).toHaveBeenCalledWith(
        'hash-1',
        'c-9',
        'admin',
      );
    });

    it('discards', async () => {
      service.discardEmail.mockResolvedValue(emailEntry as never);
      await controller.discardEmail(reqAs(admin), 'hash-1');
      expect(service.discardEmail).toHaveBeenCalledWith('hash-1');
    });

    it('fetches a presigned original url', async () => {
      service.getOriginalUrl.mockResolvedValue({ url: 'https://signed' });
      await expect(
        controller.getOriginalUrl(reqAs(admin), 'hash-1'),
      ).resolves.toEqual({
        url: 'https://signed',
      });
    });
  });

  describe.each([
    ['tutor', tutor],
    ['groupless user', groupless],
  ])('as a %s', (_label, user) => {
    it('every endpoint is forbidden and never reaches the service', async () => {
      await expect(
        controller.getEmailsByContact(reqAs(user), 'c-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(controller.getUnmatchedEmails(reqAs(user))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        controller.assignEmail(reqAs(user), 'hash-1', { contact_id: 'c-9' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.discardEmail(reqAs(user), 'hash-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.getOriginalUrl(reqAs(user), 'hash-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(service.getEmailsByContact).not.toHaveBeenCalled();
      expect(service.getUnmatchedEmails).not.toHaveBeenCalled();
      expect(service.assignEmail).not.toHaveBeenCalled();
      expect(service.discardEmail).not.toHaveBeenCalled();
      expect(service.getOriginalUrl).not.toHaveBeenCalled();
    });
  });
});
