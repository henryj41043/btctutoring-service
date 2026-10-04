import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DocumentsService,
  KEY_PREFIX,
  LINK_SECONDS,
  PENDING_MAX_AGE_MS,
} from './documents.service';
import { DocumentsModel } from '../models/documents.model';
import { ContactsModel } from '../models/contacts.model';
import { ContactDocument } from '../models/contact-document.model';
import { ModelMock, scanResolves } from '../../test/model-mock';
import {
  INFECTED_MESSAGE,
  SCANNING_MESSAGE,
  UNSCANNED_MESSAGE,
} from './scan-status';

jest.mock('../models/documents.model', () => ({
  DocumentsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('../models/contacts.model', () => ({
  ContactsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => 'uuid-1',
}));

const Model = DocumentsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;
const signedUrl = getSignedUrl as jest.Mock;
const s3 = mockClient(S3Client);

const NOW = new Date('2026-09-28T12:00:00.000Z');

const doc = (over: Partial<ContactDocument> = {}): ContactDocument => ({
  id: 'd-1',
  contact_id: 'c-1',
  file_name: 'resume.pdf',
  content_type: 'application/pdf',
  size: 1000,
  s3_key: 'documents/c-1/d-1',
  status: 'ready',
  uploaded_by: 'admin',
  uploaded_at: '2026-09-20T10:00:00.000Z',
  ...over,
});

const request = {
  file_name: 'resume.pdf',
  content_type: 'application/pdf',
  size: 1000,
};

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    s3.reset();
    s3.on(DeleteObjectCommand).resolves({});
    process.env.DOCUMENTS_BUCKET = 'docs-bucket';
    signedUrl.mockResolvedValue('https://signed');
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentsService],
    }).compile();
    service = module.get(DocumentsService);
  });

  afterEach(() => {
    delete process.env.DOCUMENTS_BUCKET;
  });

  const deletedKeys = () =>
    s3.commandCalls(DeleteObjectCommand).map((call) => call.args[0].input);

  it('keeps links five minutes, unused uploads a day, files under documents/', () => {
    expect(LINK_SECONDS).toBe(300);
    expect(PENDING_MAX_AGE_MS).toBe(86400000);
    expect(KEY_PREFIX).toBe('documents/');
  });

  describe('getDocumentsByContact', () => {
    it('lists ready documents newest first', async () => {
      const older = doc({ id: 'old', uploaded_at: '2026-09-01T10:00:00.000Z' });
      const newer = doc({ id: 'new', uploaded_at: '2026-09-25T10:00:00.000Z' });
      const undated = doc({ id: 'undated', uploaded_at: undefined });
      scanResolves(Model, [older, undated, newer]);
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual([
        newer,
        older,
        undated,
      ]);
      expect(Model.scan).toHaveBeenCalledWith({ contact_id: { eq: 'c-1' } });
      expect(deletedKeys()).toEqual([]);
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('hides an upload in progress and clears one abandoned over a day ago', async () => {
      const fresh = doc({
        id: 'fresh',
        status: 'pending',
        uploaded_at: '2026-09-27T12:00:00.000Z',
      });
      const stale = doc({
        id: 'stale',
        status: 'pending',
        s3_key: 'documents/c-1/stale',
        uploaded_at: '2026-09-27T11:59:59.999Z',
      });
      const unknown = doc({
        id: 'unknown',
        status: undefined,
        uploaded_at: undefined,
        s3_key: undefined,
      });
      scanResolves(Model, [fresh, stale, unknown]);
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual(
        [],
      );
      expect(deletedKeys()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/stale' },
      ]);
      expect(Model.delete.mock.calls.map(([key]) => key.id).sort()).toEqual([
        'stale',
        'unknown',
      ]);
    });

    it('never clears an old document that is ready', async () => {
      scanResolves(Model, [doc({ uploaded_at: '2020-01-01T00:00:00.000Z' })]);
      await expect(
        service.getDocumentsByContact('c-1', NOW),
      ).resolves.toHaveLength(1);
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('still lists when clearing fails', async () => {
      const error = jest
        .spyOn(Logger, 'error')
        .mockImplementation(() => undefined);
      s3.on(DeleteObjectCommand).rejects(new Error('denied'));
      const ready = doc();
      scanResolves(Model, [
        ready,
        doc({
          id: 'stale',
          status: 'pending',
          uploaded_at: '2026-01-01T00:00:00.000Z',
        }),
      ]);
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual([
        ready,
      ]);
      expect(error).toHaveBeenCalledWith(
        'Stale upload stale not cleared',
        expect.any(Error),
      );
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('uses the current time by default', async () => {
      scanResolves(Model, [
        doc({ status: 'pending', uploaded_at: new Date().toISOString() }),
      ]);
      await service.getDocumentsByContact('c-1');
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('fails with a 500 when there is something to clear and no bucket', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      scanResolves(Model, [
        doc({ status: 'pending', uploaded_at: '2026-01-01T00:00:00.000Z' }),
      ]);
      await expect(service.getDocumentsByContact('c-1', NOW)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('createUploadLink', () => {
    beforeEach(() => {
      Contacts.get.mockResolvedValue({ id: 'c-1' });
      Model.__save.mockResolvedValue({});
    });

    it('writes a pending row and signs a link for that exact file', async () => {
      await expect(
        service.createUploadLink(
          'c-1',
          { ...request, file_name: 'x/Resume.pdf' },
          'admin',
          NOW,
        ),
      ).resolves.toEqual({
        id: 'uuid-1',
        url: 'https://signed',
        headers: { 'Content-Type': 'application/pdf' },
      });
      expect(Contacts.get).toHaveBeenCalledWith('c-1');
      expect(Model).toHaveBeenCalledWith({
        id: 'uuid-1',
        contact_id: 'c-1',
        file_name: 'Resume.pdf',
        content_type: 'application/pdf',
        size: 1000,
        s3_key: 'documents/c-1/uuid-1',
        status: 'pending',
        uploaded_by: 'admin',
        uploaded_at: '2026-09-28T12:00:00.000Z',
      });
      expect(Model.__save).toHaveBeenCalledTimes(1);
      const [, command, options] = signedUrl.mock.calls[0];
      expect(command.constructor.name).toBe('PutObjectCommand');
      expect(command.input).toEqual({
        Bucket: 'docs-bucket',
        Key: 'documents/c-1/uuid-1',
        ContentType: 'application/pdf',
        ContentLength: 1000,
      });
      expect(options.expiresIn).toBe(300);
      expect([...options.signableHeaders].sort()).toEqual([
        'content-length',
        'content-type',
      ]);
    });

    it('leaves a missing uploader out of the row', async () => {
      await service.createUploadLink(
        'c-1',
        request,
        undefined as unknown as string,
      );
      const written = Model.mock.calls[0][0];
      expect(written).not.toHaveProperty('uploaded_by');
      expect(Date.parse(written.uploaded_at)).not.toBeNaN();
    });

    it('refuses a file that breaks the rules, before anything is written', async () => {
      await expect(
        service.createUploadLink(
          'c-1',
          { ...request, file_name: 'a.zip' },
          'admin',
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Only PDF, Word (.doc, .docx), JPG and PNG files can be uploaded.',
        ),
      );
      expect(Contacts.get).not.toHaveBeenCalled();
      expect(Model).not.toHaveBeenCalled();
      expect(signedUrl).not.toHaveBeenCalled();
    });

    it('refuses an unknown contact', async () => {
      Contacts.get.mockResolvedValue(undefined);
      await expect(
        service.createUploadLink('nope', request, 'admin'),
      ).rejects.toThrow(new NotFoundException('Contact not found'));
      expect(Model).not.toHaveBeenCalled();
    });

    it('fails with a 500 before anything else when the bucket is not configured', async () => {
      const error = jest
        .spyOn(Logger, 'error')
        .mockImplementation(() => undefined);
      delete process.env.DOCUMENTS_BUCKET;
      await expect(
        service.createUploadLink('c-1', request, 'admin'),
      ).rejects.toThrow(
        new InternalServerErrorException('Document storage is not configured'),
      );
      expect(error).toHaveBeenCalledWith(
        'DOCUMENTS_BUCKET is not set — documents are unavailable.',
      );
      expect(Contacts.get).not.toHaveBeenCalled();
    });
  });

  describe('completeUpload', () => {
    it('marks the document ready when storage holds what was announced', async () => {
      const pending = doc({ status: 'pending' });
      Model.get.mockResolvedValue(pending);
      Model.update.mockResolvedValue(doc());
      s3.on(HeadObjectCommand).resolves({
        ContentLength: 1000,
        ContentType: 'application/pdf',
      });
      await expect(service.completeUpload('d-1')).resolves.toEqual(doc());
      expect(Model.get).toHaveBeenCalledWith({ id: 'd-1' });
      expect(s3.commandCalls(HeadObjectCommand)[0].args[0].input).toEqual({
        Bucket: 'docs-bucket',
        Key: 'documents/c-1/d-1',
      });
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'd-1' },
        { status: 'ready', scan_status: 'scanning' },
      );
    });

    it('does nothing for a document that is already ready', async () => {
      Model.get.mockResolvedValue(doc());
      await expect(service.completeUpload('d-1')).resolves.toEqual(doc());
      expect(s3.commandCalls(HeadObjectCommand)).toHaveLength(0);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it.each([
      ['size', { ContentLength: 999, ContentType: 'application/pdf' }],
      ['type', { ContentLength: 1000, ContentType: 'text/html' }],
    ])('removes a file whose %s differs', async (_what, stored) => {
      Model.get.mockResolvedValue(doc({ status: 'pending' }));
      s3.on(HeadObjectCommand).resolves(stored);
      await expect(service.completeUpload('d-1')).rejects.toThrow(
        new BadRequestException(
          'The file received does not match the upload request.',
        ),
      );
      expect(deletedKeys()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/d-1' },
      ]);
      expect(Model.delete).toHaveBeenCalledWith({ id: 'd-1' });
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('reports a file that never arrived and keeps the row for a retry', async () => {
      const error = jest
        .spyOn(Logger, 'error')
        .mockImplementation(() => undefined);
      Model.get.mockResolvedValue(doc({ status: 'pending' }));
      s3.on(HeadObjectCommand).rejects(new Error('NotFound'));
      await expect(service.completeUpload('d-1')).rejects.toThrow(
        new BadRequestException('The file was not received.'),
      );
      expect(error).toHaveBeenCalledWith(
        'Upload d-1 not found in storage',
        expect.any(Error),
      );
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown document', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.completeUpload('nope')).rejects.toThrow(
        new NotFoundException('Document not found'),
      );
    });

    it('needs the bucket', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      await expect(service.completeUpload('d-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(Model.get).not.toHaveBeenCalled();
    });
  });

  describe('getDocumentUrl', () => {
    it('signs a view link that shows a PDF in the browser', async () => {
      Model.get.mockResolvedValue(doc());
      await expect(service.getDocumentUrl('d-1', 'view')).resolves.toEqual({
        url: 'https://signed',
      });
      const [, command, options] = signedUrl.mock.calls[0];
      expect(command.constructor.name).toBe('GetObjectCommand');
      expect(command.input).toEqual({
        Bucket: 'docs-bucket',
        Key: 'documents/c-1/d-1',
        ResponseContentType: 'application/pdf',
        ResponseContentDisposition:
          'inline; filename="resume.pdf"; filename*=UTF-8\'\'resume.pdf',
      });
      expect(options).toEqual({ expiresIn: 300 });
    });

    it('signs a download link, with a fallback name', async () => {
      Model.get.mockResolvedValue(doc({ file_name: undefined }));
      await service.getDocumentUrl('d-1', 'download');
      expect(signedUrl.mock.calls[0][1].input.ResponseContentDisposition).toBe(
        'attachment; filename="document"; filename*=UTF-8\'\'document',
      );
    });

    it.each([
      ['still pending', doc({ status: 'pending' })],
      ['without a stored file', doc({ s3_key: undefined })],
      ['unknown', undefined],
    ])('is a 404 for a document that is %s', async (_what, row) => {
      Model.get.mockResolvedValue(row);
      await expect(service.getDocumentUrl('d-1', 'view')).rejects.toThrow(
        new NotFoundException('Document not found'),
      );
      expect(signedUrl).not.toHaveBeenCalled();
    });

    it('needs the bucket', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      await expect(service.getDocumentUrl('d-1', 'view')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('malware scan', () => {
    const scanning = (over: Partial<ContactDocument> = {}) =>
      doc({
        scan_status: 'scanning',
        uploaded_at: '2026-09-28T11:59:00.000Z',
        ...over,
      });
    const tagged = (value?: string) =>
      s3.on(GetObjectTaggingCommand).resolves({
        TagSet: [
          { Key: 'other', Value: 'NO_THREATS_FOUND' },
          ...(value === undefined
            ? []
            : [{ Key: 'GuardDutyMalwareScanStatus', Value: value }]),
        ],
      });
    const tagReads = () =>
      s3
        .commandCalls(GetObjectTaggingCommand)
        .map((call) => call.args[0].input);

    it('opens a document the scan found clean, and records the verdict', async () => {
      Model.get.mockResolvedValue(scanning());
      tagged('NO_THREATS_FOUND');
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).resolves.toEqual(
        { url: 'https://signed' },
      );
      expect(tagReads()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/d-1' },
      ]);
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'd-1' },
        { scan_status: 'clean' },
      );
      expect(deletedKeys()).toEqual([]);
    });

    it.each([
      ['clean', doc({ scan_status: 'clean' })],
      ['stored before scanning existed', doc()],
    ])(
      'opens a document that is %s without asking storage',
      async (_w, row) => {
        Model.get.mockResolvedValue(row);
        await expect(service.getDocumentUrl('d-1', 'view')).resolves.toEqual({
          url: 'https://signed',
        });
        expect(tagReads()).toEqual([]);
        expect(Model.update).not.toHaveBeenCalled();
      },
    );

    it('removes an infected file, keeps its row marked and refuses to open it', async () => {
      const warn = jest.spyOn(Logger, 'warn').mockImplementation();
      Model.get.mockResolvedValue(scanning());
      tagged('THREATS_FOUND');
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).rejects.toThrow(
        new BadRequestException(INFECTED_MESSAGE),
      );
      expect(deletedKeys()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/d-1' },
      ]);
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'd-1' },
        { scan_status: 'infected' },
      );
      expect(Model.delete).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        'Document d-1 was blocked by the malware scan',
      );
      expect(signedUrl).not.toHaveBeenCalled();
    });

    it('refuses a file the scanner could not read, and records that', async () => {
      Model.get.mockResolvedValue(scanning());
      tagged('UNSUPPORTED');
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).rejects.toThrow(
        new BadRequestException(UNSCANNED_MESSAGE),
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'd-1' },
        { scan_status: 'unscanned' },
      );
      expect(deletedKeys()).toEqual([]);
    });

    it.each([
      ['a tag set without the scan tag', () => tagged()],
      ['no tag set at all', () => s3.on(GetObjectTaggingCommand).resolves({})],
    ])('asks to wait while the scan runs (%s)', async (_what, arrange) => {
      Model.get.mockResolvedValue(scanning());
      arrange();
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).rejects.toThrow(
        new BadRequestException(SCANNING_MESSAGE),
      );
      expect(Model.update).not.toHaveBeenCalled();
      expect(signedUrl).not.toHaveBeenCalled();
    });

    it('gives up on a scan with no verdict after fifteen minutes, without recording it', async () => {
      Model.get.mockResolvedValue(
        scanning({ uploaded_at: '2026-09-28T11:44:00.000Z' }),
      );
      tagged();
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).rejects.toThrow(
        new BadRequestException(UNSCANNED_MESSAGE),
      );
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('keeps the document closed when the verdict cannot be read', async () => {
      const log = jest.spyOn(Logger, 'error').mockImplementation();
      const failure = new Error('denied');
      Model.get.mockResolvedValue(scanning());
      s3.on(GetObjectTaggingCommand).rejects(failure);
      await expect(service.getDocumentUrl('d-1', 'view', NOW)).rejects.toThrow(
        new BadRequestException(SCANNING_MESSAGE),
      );
      expect(log).toHaveBeenCalledWith('Scan result of d-1 not read', failure);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('uses the current time by default', async () => {
      Model.get.mockResolvedValue(
        scanning({ uploaded_at: '2020-01-01T00:00:00.000Z' }),
      );
      tagged();
      await expect(service.getDocumentUrl('d-1', 'view')).rejects.toThrow(
        new BadRequestException(UNSCANNED_MESSAGE),
      );
    });

    it('brings the list up to date with the verdicts', async () => {
      const waiting = scanning({ id: 'a', s3_key: 'documents/c-1/a' });
      const legacy = doc({ id: 'b', uploaded_at: '2026-09-01T10:00:00.000Z' });
      scanResolves(Model, [legacy, waiting]);
      tagged('NO_THREATS_FOUND');
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual([
        { ...waiting, scan_status: 'clean' },
        legacy,
      ]);
      expect(tagReads()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/a' },
      ]);
      expect(Model.update).toHaveBeenCalledTimes(1);
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'a' },
        { scan_status: 'clean' },
      );
    });

    it('lists settled documents without the bucket or storage', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      const clean = doc({ scan_status: 'clean' });
      scanResolves(Model, [clean]);
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual([
        clean,
      ]);
      expect(tagReads()).toEqual([]);
    });

    it('shows a timed-out scan as unscanned in the list', async () => {
      const stuck = scanning({ uploaded_at: '2026-09-28T11:00:00.000Z' });
      scanResolves(Model, [stuck]);
      tagged();
      await expect(service.getDocumentsByContact('c-1', NOW)).resolves.toEqual([
        { ...stuck, scan_status: 'unscanned' },
      ]);
    });
  });

  describe('deleteDocument', () => {
    it('removes the file, then the row', async () => {
      Model.get.mockResolvedValue(doc());
      await expect(service.deleteDocument('d-1')).resolves.toEqual({
        id: 'd-1',
        message: 'Document deleted successfully.',
      });
      expect(deletedKeys()).toEqual([
        { Bucket: 'docs-bucket', Key: 'documents/c-1/d-1' },
      ]);
      expect(Model.delete).toHaveBeenCalledWith({ id: 'd-1' });
    });

    it('keeps the row when the file could not be removed', async () => {
      Model.get.mockResolvedValue(doc());
      s3.on(DeleteObjectCommand).rejects(new Error('denied'));
      await expect(service.deleteDocument('d-1')).rejects.toThrow('denied');
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown document, and needs the bucket', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.deleteDocument('nope')).rejects.toThrow(
        NotFoundException,
      );
      delete process.env.DOCUMENTS_BUCKET;
      await expect(service.deleteDocument('d-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('deleteDocumentsByContact', () => {
    it('removes every document of the contact, pending ones included', async () => {
      scanResolves(Model, [
        doc({ id: 'a', s3_key: 'documents/c-1/a' }),
        doc({ id: 'b', s3_key: 'documents/c-1/b', status: 'pending' }),
      ]);
      await expect(service.deleteDocumentsByContact('c-1')).resolves.toEqual({
        deleted: 2,
      });
      expect(Model.scan).toHaveBeenCalledWith({ contact_id: { eq: 'c-1' } });
      expect(deletedKeys().map((input) => input.Key)).toEqual([
        'documents/c-1/a',
        'documents/c-1/b',
      ]);
      expect(Model.delete.mock.calls).toEqual([[{ id: 'a' }], [{ id: 'b' }]]);
    });

    it('reports zero without needing the bucket', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      scanResolves(Model, []);
      await expect(service.deleteDocumentsByContact('c-1')).resolves.toEqual({
        deleted: 0,
      });
    });

    it('needs the bucket when there is something to delete', async () => {
      delete process.env.DOCUMENTS_BUCKET;
      scanResolves(Model, [doc()]);
      await expect(service.deleteDocumentsByContact('c-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
