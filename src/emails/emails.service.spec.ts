import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EmailsService } from './emails.service';
import { EmailsModel } from '../models/emails.model';
import { EmailEntry } from '../models/email-entry.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('../models/emails.model', () => ({
  EmailsModel: require('../../test/model-mock').makeModelMock(),
}));
// getSignedUrl is a bare function (not a client method), so aws-sdk-client-mock
// can't intercept it — module-mock it instead.
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const Model = EmailsModel as unknown as ModelMock;
const signedUrl = getSignedUrl as jest.Mock;

const entry = (overrides: Partial<EmailEntry> = {}): EmailEntry =>
  ({
    id: 'hash-1',
    status: 'matched',
    contact_id: 'c-1',
    from_email: 'jane@example.com',
    subject: 'Schedule change',
    sent_at: '2026-08-04T13:12:00Z',
    received_at: '2026-08-04T14:00:00Z',
    body_text: 'Can we move to Friday?',
    s3_key: 'inbound/abc123',
    match_method: 'inline',
    ...overrides,
  }) as EmailEntry;

describe('EmailsService', () => {
  let service: EmailsService;

  beforeEach(async () => {
    process.env.EMAIL_BUCKET = 'test-bucket';
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailsService],
    }).compile();
    service = module.get<EmailsService>(EmailsService);
  });

  afterEach(() => {
    delete process.env.EMAIL_BUCKET;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getEmailsByContact', () => {
    it('scans matched entries for the contact, newest original first', async () => {
      const older = entry({ id: 'old', sent_at: '2026-08-01T10:00:00Z' });
      const newer = entry({ id: 'new', sent_at: '2026-08-05T10:00:00Z' });
      scanResolves(Model, [older, newer]);
      await expect(service.getEmailsByContact('c-1')).resolves.toEqual([
        newer,
        older,
      ]);
      expect(Model.scan).toHaveBeenCalledWith({
        contact_id: { eq: 'c-1' },
        status: { eq: 'matched' },
      });
    });

    it('falls back to received_at when sent_at is missing', async () => {
      const noSent = entry({
        id: 'no-sent',
        sent_at: undefined,
        received_at: '2026-08-06T10:00:00Z',
      });
      const sent = entry({ id: 'sent', sent_at: '2026-08-05T10:00:00Z' });
      const bare = entry({
        id: 'bare',
        sent_at: undefined,
        received_at: undefined,
      });
      scanResolves(Model, [bare, sent, noSent]);
      await expect(service.getEmailsByContact('c-1')).resolves.toEqual([
        noSent,
        sent,
        bare,
      ]);
    });

    it('propagates scan errors', async () => {
      scanRejects(Model, new Error('ddb down'));
      await expect(service.getEmailsByContact('c-1')).rejects.toThrow(
        'ddb down',
      );
    });

    it('keeps dateless entries stable relative to each other', async () => {
      const bare1 = entry({
        id: 'bare1',
        sent_at: undefined,
        received_at: undefined,
      });
      const bare2 = entry({
        id: 'bare2',
        sent_at: undefined,
        received_at: undefined,
      });
      scanResolves(Model, [bare1, bare2]);
      await expect(service.getEmailsByContact('c-1')).resolves.toEqual([
        bare1,
        bare2,
      ]);
    });
  });

  describe('getUnmatchedEmails', () => {
    it('scans the unmatched queue newest first', async () => {
      const a = entry({
        id: 'a',
        status: 'unmatched',
        sent_at: undefined,
        received_at: '2026-08-01T10:00:00Z',
      });
      const b = entry({
        id: 'b',
        status: 'unmatched',
        sent_at: undefined,
        received_at: '2026-08-02T10:00:00Z',
      });
      scanResolves(Model, [a, b]);
      await expect(service.getUnmatchedEmails()).resolves.toEqual([b, a]);
      expect(Model.scan).toHaveBeenCalledWith({ status: { eq: 'unmatched' } });
    });

    it('propagates scan errors', async () => {
      scanRejects(Model, new Error('boom'));
      await expect(service.getUnmatchedEmails()).rejects.toThrow('boom');
    });
  });

  describe('assignEmail', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-08-17T15:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('files the entry on the contact with resolver provenance', async () => {
      Model.get.mockResolvedValue(
        entry({ status: 'unmatched', contact_id: undefined }),
      );
      Model.update.mockResolvedValue(entry());
      await service.assignEmail('hash-1', 'c-9', 'admin-user');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'hash-1' },
        {
          contact_id: 'c-9',
          status: 'matched',
          assigned_by: 'admin-user',
          assigned_at: '2026-08-17T15:00:00.000Z',
        },
      );
    });

    it('404s on a missing entry without updating', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.assignEmail('nope', 'c-9', 'admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('propagates update errors', async () => {
      Model.get.mockResolvedValue(entry());
      Model.update.mockRejectedValue(new Error('update failed'));
      await expect(
        service.assignEmail('hash-1', 'c-9', 'admin'),
      ).rejects.toThrow('update failed');
    });

    it('propagates lookup errors', async () => {
      Model.get.mockRejectedValue(new Error('get failed'));
      await expect(
        service.assignEmail('hash-1', 'c-9', 'admin'),
      ).rejects.toThrow('get failed');
    });
  });

  describe('discardEmail', () => {
    it('marks the row discarded but keeps it (dedup hash stays resident)', async () => {
      Model.get.mockResolvedValue(entry({ status: 'unmatched' }));
      Model.update.mockResolvedValue(entry({ status: 'discarded' }));
      await service.discardEmail('hash-1');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'hash-1' },
        { status: 'discarded' },
      );
      expect(Model.delete).not.toHaveBeenCalled();
    });

    it('404s on a missing entry', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.discardEmail('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates update errors', async () => {
      Model.get.mockResolvedValue(entry());
      Model.update.mockRejectedValue(new Error('x'));
      await expect(service.discardEmail('hash-1')).rejects.toThrow('x');
    });
  });

  describe('getOriginalUrl', () => {
    it('presigns the entry object for 5 minutes', async () => {
      Model.get.mockResolvedValue(entry());
      signedUrl.mockResolvedValue('https://signed.example/abc');
      await expect(service.getOriginalUrl('hash-1')).resolves.toEqual({
        url: 'https://signed.example/abc',
      });
      const [, command, options] = signedUrl.mock.calls[0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'inbound/abc123',
      });
      expect(options).toEqual({ expiresIn: 300 });
    });

    it('fails closed when EMAIL_BUCKET is unset (before any lookup)', async () => {
      delete process.env.EMAIL_BUCKET;
      await expect(service.getOriginalUrl('hash-1')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(Model.get).not.toHaveBeenCalled();
    });

    it('404s when the entry is missing', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.getOriginalUrl('nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(signedUrl).not.toHaveBeenCalled();
    });

    it('404s when the entry has no stored original', async () => {
      Model.get.mockResolvedValue(entry({ s3_key: undefined }));
      await expect(service.getOriginalUrl('hash-1')).rejects.toThrow(
        'No original stored for this email',
      );
    });
  });
});
