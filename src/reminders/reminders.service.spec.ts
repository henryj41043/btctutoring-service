import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { RemindersService } from './reminders.service';
import { ContactsService } from '../contacts/contacts.service';
import { Reminder } from '../models/reminder.model';
import { RemindersModel } from '../models/reminders.model';
import { ModelMock, scanResolves, scanRejects } from '../../test/model-mock';

jest.mock('../models/reminders.model', () => ({
  RemindersModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = RemindersModel as unknown as ModelMock;

const sesMock = mockClient(SESClient);

/** Today's Eastern wall date, matching the service's own formatting. */
const easternToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );

const dueReminder = (over: Partial<Reminder> = {}): Reminder =>
  ({
    id: 'rem-1',
    title: 'Call John',
    message: 'He cancels effective July 31st',
    date: easternToday(),
    all_admins: true,
    recipient_ids: [],
    ...over,
  }) as Reminder;

const adminContact = (over: Record<string, unknown> = {}) => ({
  id: 'a-1',
  first_name: 'Amy',
  email: 'amy@example.com',
  ...over,
});

describe('RemindersService', () => {
  let service: RemindersService;
  let contactsService: jest.Mocked<ContactsService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({});
    process.env.SES_FROM_EMAIL = 'noreply@example.com';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: ContactsService, useValue: { getAdminContacts: jest.fn() } },
      ],
    }).compile();
    service = module.get(RemindersService);
    contactsService = module.get(ContactsService);
  });

  describe('CRUD', () => {
    it('lists reminders', async () => {
      scanResolves(Model, [dueReminder()]);
      const result = await service.getReminders();
      expect(result).toHaveLength(1);
    });

    it('propagates list failures', async () => {
      scanRejects(Model, new Error('scan failed'));
      await expect(service.getReminders()).rejects.toThrow('scan failed');
    });

    it('creates a reminder with defaults and a generated id', async () => {
      Model.__save.mockResolvedValue({});
      const result = await service.createReminder({
        title: 'Call John',
        message: 'msg',
        date: '2026-08-01',
      } as Reminder);
      expect(result.message).toBe('Reminder created successfully.');
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Call John',
          all_admins: false,
          recipient_ids: [],
          id: expect.any(String),
        }),
      );
    });

    it('propagates create failures', async () => {
      Model.__save.mockRejectedValue(new Error('save failed'));
      await expect(service.createReminder(dueReminder())).rejects.toThrow(
        'save failed',
      );
    });

    it('re-arms sent_at and completed_at only when the date changes', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9', date: '2000-01-01' }));
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(
        dueReminder({ id: 'rem-9', sent_at: 'should-not-persist' }),
      );
      const [key, update] = Model.update.mock.calls.at(-1)!;
      expect(key).toEqual({ id: 'rem-9' });
      expect(update.$SET).toEqual(
        expect.objectContaining({ title: 'Call John' }),
      );
      expect(update.$SET.sent_at).toBeUndefined();
      // Rescheduling re-arms fully: a completed reminder fires on its new day.
      expect(update.$REMOVE).toEqual([
        'sent_at', 'completed_at', 'contact_id', 'due_date', 'recurrence',
      ]);
    });

    it('keeps sent_at when the date is unchanged (the v1 re-fire bug)', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9' })); // same date
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({ id: 'rem-9' }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$REMOVE).toEqual(['contact_id', 'due_date', 'recurrence']);
    });

    it('treats a missing stored record as a date change (safe re-arm)', async () => {
      Model.get.mockResolvedValue(undefined);
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({ id: 'rem-9' }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$REMOVE[0]).toBe('sent_at');
    });

    it('persists a contact link on create and update', async () => {
      Model.__save.mockResolvedValue({});
      await service.createReminder(dueReminder({ contact_id: 'c-9' }));
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({ contact_id: 'c-9' }),
      );

      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9', date: '2000-01-01' }));
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({ id: 'rem-9', contact_id: 'c-9' }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET.contact_id).toBe('c-9');
      expect(update.$REMOVE).toEqual(['sent_at', 'completed_at', 'due_date', 'recurrence']);
    });

    it('clears the contact link when absent on update', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9', date: '2000-01-01' }));
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({ id: 'rem-9' }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET.contact_id).toBeUndefined();
      expect(update.$REMOVE).toEqual([
        'sent_at', 'completed_at', 'contact_id', 'due_date', 'recurrence',
      ]);
    });

    it('propagates update failures', async () => {
      Model.get.mockResolvedValue(dueReminder());
      Model.update.mockRejectedValue(new Error('update failed'));
      await expect(service.updateReminder(dueReminder())).rejects.toThrow(
        'update failed',
      );
    });

    it('deletes a reminder', async () => {
      Model.delete.mockResolvedValue({});
      const result = await service.deleteReminder('rem-1');
      expect(Model.delete).toHaveBeenCalledWith({ id: 'rem-1' });
      expect(result.message).toBe('Reminder deleted successfully.');
    });

    it('propagates delete failures', async () => {
      Model.delete.mockRejectedValue(new Error('delete failed'));
      await expect(service.deleteReminder('rem-1')).rejects.toThrow(
        'delete failed',
      );
    });
  });

  describe('v2 fields on create/update', () => {
    it('passes due_date, recurrence, and created_by through on create', async () => {
      Model.__save.mockResolvedValue({});
      await service.createReminder(dueReminder({
        due_date: '2026-08-20', recurrence: 'monthly', created_by: 'a-1',
      }));
      expect(Model).toHaveBeenCalledWith(expect.objectContaining({
        due_date: '2026-08-20', recurrence: 'monthly', created_by: 'a-1',
      }));
    });

    it('persists v2 fields on update; recurrence strips completed_at', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9' })); // same date
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({
        id: 'rem-9', due_date: '2026-08-20', recurrence: 'weekly',
        contact_id: 'c-9', created_by: 'a-2',
      }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).toEqual(expect.objectContaining({
        due_date: '2026-08-20', recurrence: 'weekly', created_by: 'a-2',
      }));
      // Invariant: recurring reminders never carry a completion stamp.
      expect(update.$REMOVE).toEqual(['completed_at']);
    });

    it('never strips created_by when the payload omits it', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-9' }));
      Model.update.mockResolvedValue(dueReminder());
      await service.updateReminder(dueReminder({ id: 'rem-9' }));
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET.created_by).toBeUndefined();
      expect(update.$REMOVE).not.toContain('created_by');
    });
  });

  describe('completeReminder / uncompleteReminder', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      // 14:00 ET — the same wall date in UTC and Eastern, so easternToday()
      // agrees with the UTC date math in assertions.
      jest.setSystemTime(new Date('2026-08-05T18:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('stamps completed_at on a one-time reminder', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-1' }));
      Model.update.mockResolvedValue({});
      const result = await service.completeReminder('rem-1');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { completed_at: expect.any(String) },
      );
      expect(result.message).toBe('Reminder completed.');
    });

    it('advances an on-time weekly reminder to next week', async () => {
      Model.get.mockResolvedValue(
        dueReminder({ id: 'rem-1', date: '2026-08-05', recurrence: 'weekly' }),
      );
      Model.update.mockResolvedValue({});
      const result = await service.completeReminder('rem-1');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { $SET: { date: '2026-08-12' }, $REMOVE: ['sent_at'] },
      );
      expect(result.message).toBe('Reminder occurrence completed.');
    });

    it('jumps an overdue weekly reminder to the first future occurrence', async () => {
      Model.get.mockResolvedValue(
        dueReminder({ id: 'rem-1', date: '2026-07-15', recurrence: 'weekly' }),
      );
      Model.update.mockResolvedValue({});
      await service.completeReminder('rem-1');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { $SET: { date: '2026-08-12' }, $REMOVE: ['sent_at'] },
      );
    });

    it('advances an early-completed future occurrence from its own date', async () => {
      Model.get.mockResolvedValue(
        dueReminder({ id: 'rem-1', date: '2026-08-19', recurrence: 'weekly' }),
      );
      Model.update.mockResolvedValue({});
      await service.completeReminder('rem-1');
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { $SET: { date: '2026-08-26' }, $REMOVE: ['sent_at'] },
      );
    });

    it('404s on an unknown reminder', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.completeReminder('nope')).rejects.toThrow(
        'Reminder not found',
      );
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('propagates a failed completion update', async () => {
      Model.get.mockResolvedValue(dueReminder({ id: 'rem-1' }));
      Model.update.mockRejectedValue(new Error('complete boom'));
      await expect(service.completeReminder('rem-1')).rejects.toThrow(
        'complete boom',
      );
    });

    it('uncomplete removes the stamp without a read', async () => {
      Model.update.mockResolvedValue({});
      const result = await service.uncompleteReminder('rem-1');
      expect(Model.get).not.toHaveBeenCalled();
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { $REMOVE: ['completed_at'] },
      );
      expect(result.message).toBe('Reminder reopened.');
    });
  });

  describe('sendDueReminders (9am ET cron)', () => {
    it('sends one digest per admin and marks reminders sent', async () => {
      scanResolves(Model, [
        dueReminder(),
        dueReminder({ id: 'rem-2', title: 'Second' }),
      ]);
      Model.update.mockResolvedValue({});
      contactsService.getAdminContacts.mockResolvedValue([
        adminContact(),
        adminContact({
          id: 'a-2',
          first_name: 'Ben',
          email: 'ben@example.com',
        }),
      ] as never);

      await service.sendDueReminders();

      const sends = sesMock.commandCalls(SendEmailCommand);
      expect(sends).toHaveLength(2); // one digest per admin
      const first = sends[0].args[0].input;
      expect(first.Message!.Subject!.Data).toBe('2 reminders for today');
      expect(first.Message!.Body!.Text!.Data).toContain('Call John');
      expect(first.Message!.Body!.Text!.Data).toContain('Second');
      // Both reminders stamped sent.
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { sent_at: expect.any(String) },
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-2' },
        { sent_at: expect.any(String) },
      );
    });

    it('respects individual recipients when not all_admins', async () => {
      scanResolves(Model, [
        dueReminder({ all_admins: false, recipient_ids: ['a-2'] }),
      ]);
      Model.update.mockResolvedValue({});
      contactsService.getAdminContacts.mockResolvedValue([
        adminContact(),
        adminContact({ id: 'a-2', email: 'ben@example.com' }),
      ] as never);

      await service.sendDueReminders();

      const sends = sesMock.commandCalls(SendEmailCommand);
      expect(sends).toHaveLength(1);
      expect(sends[0].args[0].input.Destination!.ToAddresses).toEqual([
        'ben@example.com',
      ]);
      expect(sends[0].args[0].input.Message!.Subject!.Data).toBe(
        'Reminder: Call John',
      );
    });

    it('skips reminders already sent and those due other days', async () => {
      scanResolves(Model, [
        dueReminder({ sent_at: '2026-07-27T13:00:00Z' }),
        dueReminder({ id: 'rem-3', date: '2000-01-01' }),
      ]);
      contactsService.getAdminContacts.mockResolvedValue([
        adminContact(),
      ] as never);

      await service.sendDueReminders();

      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('fails closed without SES_FROM_EMAIL and marks nothing sent', async () => {
      delete process.env.SES_FROM_EMAIL;
      scanResolves(Model, [dueReminder()]);

      await service.sendDueReminders();

      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('aborts without marking sent when the admin fetch fails', async () => {
      scanResolves(Model, [dueReminder()]);
      contactsService.getAdminContacts.mockRejectedValue(new Error('boom'));

      await service.sendDueReminders();

      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('one admin failure does not block the others; reminders still marked', async () => {
      scanResolves(Model, [dueReminder()]);
      Model.update.mockResolvedValue({});
      contactsService.getAdminContacts.mockResolvedValue([
        adminContact({ email: undefined }), // skipped, no email
        adminContact({ id: 'a-2', email: 'ben@example.com' }),
      ] as never);
      sesMock
        .on(SendEmailCommand)
        .rejectsOnce(new Error('ses down'))
        .resolves({});

      await service.sendDueReminders();

      // Send attempted for the admin with an email; reminder still marked.
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { sent_at: expect.any(String) },
      );
    });

    it('does nothing when no reminders are due', async () => {
      scanResolves(Model, []);
      await service.sendDueReminders();
      expect(contactsService.getAdminContacts).not.toHaveBeenCalled();
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });
  });
  describe('cron v2 behaviors', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-08-05T18:00:00Z')); // 14:00 ET
      process.env.SES_FROM_EMAIL = 'noreply@example.com';
      sesMock.reset();
      sesMock.on(SendEmailCommand).resolves({});
    });
    afterEach(() => jest.useRealTimers());

    it('advances a recurring reminder instead of stamping sent_at', async () => {
      scanResolves(Model, [
        dueReminder({ id: 'rem-1', date: '2026-08-05', recurrence: 'weekly' }),
      ]);
      contactsService.getAdminContacts.mockResolvedValue([adminContact()] as never);
      Model.update.mockResolvedValue({});
      await service.sendDueReminders();
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'rem-1' },
        { $SET: { date: '2026-08-12' }, $REMOVE: ['sent_at'] },
      );
      // Never stamped — the series continues.
      expect(Model.update).not.toHaveBeenCalledWith(
        { id: 'rem-1' },
        { sent_at: expect.any(String) },
      );
    });

    it('skips one-time reminders completed early', async () => {
      scanResolves(Model, [
        dueReminder({ id: 'rem-1', date: '2026-08-05', completed_at: '2026-08-04T12:00:00Z' }),
      ]);
      await service.sendDueReminders();
      expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('appends the due-by suffix only when a due date exists', async () => {
      scanResolves(Model, [
        dueReminder({ id: 'rem-1', title: 'Bill Casey', message: '', date: '2026-08-05', due_date: '2026-08-20' }),
        dueReminder({ id: 'rem-2', title: 'No due here', message: '', date: '2026-08-05' }),
      ]);
      contactsService.getAdminContacts.mockResolvedValue([adminContact()] as never);
      Model.update.mockResolvedValue({});
      await service.sendDueReminders();
      const body = sesMock.commandCalls(SendEmailCommand)[0].args[0].input
        .Message!.Body!.Text!.Data as string;
      expect(body).toContain('Bill Casey (due Aug 20)');
      expect(body).toContain('No due here');
      expect(body).not.toContain('No due here (due');
    });
  });

});
