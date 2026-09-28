import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import express from 'express';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { User } from '../models/user.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = { ...admin, username: 'tutor', groups: ['Tutors'] };
const groupless: User = {
  ...admin,
  username: 'nogroups',
  groups: undefined as unknown as string[],
};

const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const body = {
  file_name: 'resume.pdf',
  content_type: 'application/pdf',
  size: 10,
};

describe('DocumentsController', () => {
  let controller: DocumentsController;
  const service = {
    getDocumentsByContact: jest.fn(),
    createUploadLink: jest.fn(),
    completeUpload: jest.fn(),
    getDocumentUrl: jest.fn(),
    deleteDocument: jest.fn(),
    deleteDocumentsByContact: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: service }],
    }).compile();
    controller = module.get(DocumentsController);
  });

  it("lists a contact's documents for an admin", async () => {
    service.getDocumentsByContact.mockResolvedValue([{ id: 'd-1' }]);
    await expect(
      controller.getDocumentsByContact(reqAs(admin), 'c-1'),
    ).resolves.toEqual([{ id: 'd-1' }]);
    expect(service.getDocumentsByContact).toHaveBeenCalledWith('c-1');
  });

  it("creates an upload link in the admin's name", async () => {
    service.createUploadLink.mockResolvedValue({
      id: 'd-1',
      url: 'u',
      headers: {},
    });
    await expect(
      controller.createUploadLink(reqAs(admin), 'c-1', body),
    ).resolves.toEqual({
      id: 'd-1',
      url: 'u',
      headers: {},
    });
    expect(service.createUploadLink).toHaveBeenCalledWith('c-1', body, 'admin');
  });

  it('completes an upload', async () => {
    service.completeUpload.mockResolvedValue({ id: 'd-1' });
    await expect(
      controller.completeUpload(reqAs(admin), 'd-1'),
    ).resolves.toEqual({ id: 'd-1' });
    expect(service.completeUpload).toHaveBeenCalledWith('d-1');
  });

  it.each([
    ['view', 'view'],
    ['download', 'download'],
    [undefined, 'download'],
    ['anything', 'download'],
  ])('opens a document with mode %p as %s', async (mode, expected) => {
    service.getDocumentUrl.mockResolvedValue({ url: 'u' });
    await expect(
      controller.getDocumentUrl(reqAs(admin), 'd-1', mode),
    ).resolves.toEqual({ url: 'u' });
    expect(service.getDocumentUrl).toHaveBeenCalledWith('d-1', expected);
  });

  it('deletes one document, and all of a contact', async () => {
    service.deleteDocument.mockResolvedValue({ id: 'd-1', message: 'ok' });
    service.deleteDocumentsByContact.mockResolvedValue({ deleted: 2 });
    await expect(
      controller.deleteDocument(reqAs(admin), 'd-1'),
    ).resolves.toEqual({ id: 'd-1', message: 'ok' });
    await expect(
      controller.deleteDocumentsByContact(reqAs(admin), 'c-1'),
    ).resolves.toEqual({ deleted: 2 });
    expect(service.deleteDocument).toHaveBeenCalledWith('d-1');
    expect(service.deleteDocumentsByContact).toHaveBeenCalledWith('c-1');
  });

  describe.each([
    ['a tutor', tutor],
    ['a user without groups', groupless],
  ])('%s', (_who, user) => {
    const calls: Array<
      [string, string, (c: DocumentsController) => Promise<unknown>]
    > = [
      [
        'list contact documents',
        'getDocumentsByContact',
        (c) => c.getDocumentsByContact(reqAs(user), 'c-1'),
      ],
      [
        'upload a document',
        'createUploadLink',
        (c) => c.createUploadLink(reqAs(user), 'c-1', body),
      ],
      [
        'complete an upload',
        'completeUpload',
        (c) => c.completeUpload(reqAs(user), 'd-1'),
      ],
      [
        'open a document',
        'getDocumentUrl',
        (c) => c.getDocumentUrl(reqAs(user), 'd-1', 'view'),
      ],
      [
        'delete a document',
        'deleteDocument',
        (c) => c.deleteDocument(reqAs(user), 'd-1'),
      ],
      [
        'delete contact documents',
        'deleteDocumentsByContact',
        (c) => c.deleteDocumentsByContact(reqAs(user), 'c-1'),
      ],
    ];

    it.each(calls)('may not %s', async (action, method, call) => {
      const error = jest
        .spyOn(Logger, 'error')
        .mockImplementation(() => undefined);
      await expect(call(controller)).rejects.toThrow(
        new ForbiddenException('Unauthorized'),
      );
      expect(error).toHaveBeenCalledWith(`User not authorized to ${action}`);
      expect(service[method as keyof typeof service]).not.toHaveBeenCalled();
    });
  });
});
