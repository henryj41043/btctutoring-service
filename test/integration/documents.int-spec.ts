import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  GetObjectTaggingCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DocumentsController } from '../../src/documents/documents.controller';
import { DocumentsService } from '../../src/documents/documents.service';
import { DocumentsModel } from '../../src/models/documents.model';
import { ContactsModel } from '../../src/models/contacts.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/documents.model', () => ({
  DocumentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const Model = DocumentsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;
const s3 = mockClient(S3Client);

const pending = {
  id: 'd-1',
  contact_id: 'c-1',
  file_name: 'resume.pdf',
  content_type: 'application/pdf',
  size: 1000,
  s3_key: 'documents/c-1/d-1',
  status: 'pending',
  uploaded_at: '2026-09-28T12:00:00.000Z',
};
const ready = { ...pending, status: 'ready' };
const upload = {
  file_name: 'resume.pdf',
  content_type: 'application/pdf',
  size: 1000,
};

describe('Documents (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DOCUMENTS_BUCKET = 'docs-bucket';
    app = await bootIntegrationApp({
      controllers: [DocumentsController],
      providers: [DocumentsService],
    });
  });

  afterAll(async () => {
    delete process.env.DOCUMENTS_BUCKET;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    s3.reset();
    s3.onAnyCommand().resolves({});
    (getSignedUrl as jest.Mock).mockResolvedValue('https://signed');
    Contacts.get.mockResolvedValue({ id: 'c-1' });
    Model.__save.mockResolvedValue({});
  });

  const server = () => app.getHttpServer();
  const asAdmin = (req: request.Test) => req.set('x-test-role', 'admin');

  it('admin uploads, completes, lists, opens and deletes a document', async () => {
    const link = await asAdmin(
      request(server()).post('/documents/contact/c-1/upload-url'),
    ).send(upload);
    expect(link.status).toBe(200);
    expect(link.body).toEqual({
      id: expect.any(String),
      url: 'https://signed',
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(Model).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        uploaded_by: 'admin',
        contact_id: 'c-1',
      }),
    );

    Model.get.mockResolvedValue(pending);
    Model.update.mockResolvedValue(ready);
    s3.on(HeadObjectCommand).resolves({
      ContentLength: 1000,
      ContentType: 'application/pdf',
    });
    const done = await asAdmin(
      request(server()).post('/documents/d-1/complete'),
    );
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('ready');

    scanResolves(Model, [ready]);
    const list = await asAdmin(request(server()).get('/documents/contact/c-1'));
    expect(list.status).toBe(200);
    expect(list.body).toEqual([ready]);

    Model.get.mockResolvedValue(ready);
    const open = await asAdmin(
      request(server()).get('/documents/d-1/url?mode=view'),
    );
    expect(open.status).toBe(200);
    expect(open.body).toEqual({ url: 'https://signed' });

    const removed = await asAdmin(request(server()).delete('/documents/d-1'));
    expect(removed.status).toBe(200);
    expect(Model.delete).toHaveBeenCalledWith({ id: 'd-1' });
  });

  it('a document is closed until the malware scan clears it', async () => {
    const scanning = {
      ...ready,
      scan_status: 'scanning',
      uploaded_at: new Date().toISOString(),
    };
    Model.get.mockResolvedValue(scanning);
    const waiting = await asAdmin(
      request(server()).get('/documents/d-1/url?mode=view'),
    );
    expect(waiting.status).toBe(400);
    expect(waiting.body.message).toBe(
      'This file is still being checked for malware. Try again in a moment.',
    );

    s3.on(GetObjectTaggingCommand).resolves({
      TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' }],
    });
    const blocked = await asAdmin(
      request(server()).get('/documents/d-1/url?mode=download'),
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toBe(
      'This file was blocked: the malware scan found a threat in it.',
    );
    expect(Model.update).toHaveBeenCalledWith(
      { id: 'd-1' },
      { scan_status: 'infected' },
    );

    s3.on(GetObjectTaggingCommand).resolves({
      TagSet: [
        { Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' },
      ],
    });
    const open = await asAdmin(
      request(server()).get('/documents/d-1/url?mode=view'),
    );
    expect(open.status).toBe(200);
    expect(open.body).toEqual({ url: 'https://signed' });
  });

  it('deleting by contact is not mistaken for deleting by id', async () => {
    scanResolves(Model, [
      ready,
      { ...ready, id: 'd-2', s3_key: 'documents/c-1/d-2' },
    ]);
    const res = await asAdmin(
      request(server()).delete('/documents/contact/c-1'),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
    expect(Model.get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'another kind of file',
      { ...upload, file_name: 'a.zip', content_type: 'application/zip' },
    ],
    ['a file over 15 MB', { ...upload, size: 15 * 1024 * 1024 + 1 }],
    ['an empty file', { ...upload, size: 0 }],
    ['a size that is not a number', { ...upload, size: 'big' }],
    ['a missing name', { content_type: 'application/pdf', size: 10 }],
  ])('refuses %s', async (_what, body) => {
    const res = await asAdmin(
      request(server()).post('/documents/contact/c-1/upload-url'),
    ).send(body);
    expect(res.status).toBe(400);
    expect(Model).not.toHaveBeenCalled();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/documents/contact/c-1'],
    ['post', '/documents/contact/c-1/upload-url'],
    ['post', '/documents/d-1/complete'],
    ['get', '/documents/d-1/url'],
    ['delete', '/documents/d-1'],
    ['delete', '/documents/contact/c-1'],
  ] as const)('a tutor cannot %s %s', async (method, path) => {
    const res = await request(server())
      [method](path)
      .set('x-test-role', 'tutor')
      .send(upload);
    expect(res.status).toBe(403);
    expect(Model.scan).not.toHaveBeenCalled();
    expect(Model.get).not.toHaveBeenCalled();
    expect(Model).not.toHaveBeenCalled();
  });
});
