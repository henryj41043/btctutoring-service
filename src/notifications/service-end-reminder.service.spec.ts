import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import {
  APP_CONTACT_URL,
  END_REMINDER_DAYS_AHEAD,
  ServiceEndReminderService,
} from './service-end-reminder.service';
import { StudentsService } from '../students/students.service';
import { ContactsService } from '../contacts/contacts.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';

const sesMock = mockClient(SESClient);

// 9am ET on 2026-10-14 → today = 2026-10-14, horizon = 2026-10-28.
const NOW = new Date('2026-10-14T13:00:00Z');

const contact = (over: Partial<Contact>): Contact =>
  ({ first_name: 'X', last_name: 'Y', ...over }) as Contact;
const STAFF = { service: 'Hiring', status: 'Staff' } as Partial<Contact>;
const adminA = contact({
  ...STAFF,
  id: 'admin-a',
  first_name: 'Ada',
  last_name: 'Admin',
  email: 'ada@x.com',
  user_group: 'Admins',
});
const adminB = contact({
  ...STAFF,
  id: 'admin-b',
  first_name: 'Bea',
  last_name: 'Boss',
  email: 'bea@x.com',
  user_group: 'Admins',
});
const adminNoEmail = contact({
  ...STAFF,
  id: 'admin-c',
  first_name: 'Cy',
  last_name: 'Quiet',
  user_group: 'Admins',
});
const formerAdmin = contact({
  id: 'admin-former',
  first_name: 'Fay',
  last_name: 'Former',
  email: 'fay@x.com',
  user_group: 'Admins',
  service: 'Hiring',
  status: 'Former Staff',
});
const tutor = contact({
  id: 't-1',
  first_name: 'Tess',
  last_name: 'One',
  email: 'tess@x.com',
  user_group: 'Tutors',
});
const family = contact({
  id: 'fam-1',
  first_name: 'Kay',
  last_name: 'Roe',
  email: 'kay@x.com',
});
const contacts = [adminA, adminB, adminNoEmail, formerAdmin, tutor, family];

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: 's-1',
    name: 'Pat',
    contact_id: 'fam-1',
    status: 'Active Student',
    assigned_tutor_id: 't-1',
    package: 'Thrive',
    service_end_date: '2026-10-28',
    end_status: 'Past Student',
    ...over,
  }) as Student;

describe('ServiceEndReminderService', () => {
  let service: ServiceEndReminderService;
  let studentsService: jest.Mocked<StudentsService>;
  let contactsService: jest.Mocked<ContactsService>;

  const sentEmails = () =>
    sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
  const recipients = () =>
    sentEmails().map((i) => i.Destination?.ToAddresses?.[0]);
  const textTo = (email: string): string =>
    sentEmails().find((i) => i.Destination?.ToAddresses?.[0] === email)?.Message
      ?.Body?.Text?.Data ?? '';
  const stamped = () =>
    studentsService.markServiceEndReminderSent.mock.calls.map(([s, date]) => [
      s.id,
      date,
    ]);

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({});
    process.env.SES_FROM_EMAIL = 'noreply@example.com';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceEndReminderService,
        {
          provide: StudentsService,
          useValue: {
            getStudents: jest.fn().mockResolvedValue([]),
            markServiceEndReminderSent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContactsService,
          useValue: { getContacts: jest.fn().mockResolvedValue(contacts) },
        },
      ],
    }).compile();
    service = module.get(ServiceEndReminderService);
    studentsService = module.get(StudentsService);
    contactsService = module.get(ContactsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('reminds two weeks ahead and links to the family page', () => {
    expect(END_REMINDER_DAYS_AHEAD).toBe(14);
    expect(APP_CONTACT_URL).toBe('https://btchub.bitshiftstudio.io/contacts/');
  });

  it('reminds every current admin with an email on the boundary day, then stamps the student', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    await service.sendServiceEndReminders();
    expect(recipients().sort()).toEqual(['ada@x.com', 'bea@x.com']);
    const email = sentEmails()[0];
    expect(email.Source).toBe('noreply@example.com');
    expect(email.Message?.Subject?.Data).toBe(
      'Service ending soon: Pat on Oct 28, 2026',
    );
    const text = textTo('ada@x.com');
    expect(text).toContain('Hi Ada,');
    expect(text).toContain("A student's service ends in the next 14 days:");
    expect(text).toContain('Pat (Kay Roe)');
    expect(text).toContain('Last day of service: Oct 28, 2026');
    expect(text).toContain('Then: Past Student');
    expect(text).toContain('Package: Thrive');
    expect(text).toContain('Tutor: Tess One');
    expect(text).toContain('https://btchub.bitshiftstudio.io/contacts/fam-1');
    expect(text).toContain('This reminder is sent once per end date.');
    expect(email.Message?.Body?.Html?.Data).toContain('Service ending soon');
    expect(textTo('bea@x.com')).toContain('Hi Bea,');
    expect(stamped()).toEqual([['s-1', '2026-10-28']]);
  });

  it('picks only active students ending after today and within the horizon, not yet stamped for that date', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({ id: 'today', service_end_date: '2026-10-14' }),
      student({ id: 'tomorrow', service_end_date: '2026-10-15' }),
      student({ id: 'late', service_end_date: '2026-10-29' }),
      student({ id: 'none', service_end_date: null }),
      student({ id: 'missing', service_end_date: undefined }),
      student({ id: 'past', status: 'Past Student' }),
      student({ id: 'done', end_reminder_sent: '2026-10-28' }),
      student({
        id: 'moved',
        service_end_date: '2026-10-20',
        end_reminder_sent: '2026-10-28',
      }),
    ] as never);
    await service.sendServiceEndReminders();
    expect(stamped()).toEqual([
      ['tomorrow', '2026-10-15'],
      ['moved', '2026-10-20'],
    ]);
    const text = textTo('ada@x.com');
    expect(text).toContain("2 students' service ends in the next 14 days:");
    expect(text.indexOf('Oct 15, 2026')).toBeLessThan(
      text.indexOf('Oct 20, 2026'),
    );
    expect(sentEmails()[0].Message?.Subject?.Data).toBe(
      "2 students' service ending soon",
    );
  });

  it('falls back when the end status, package, family or tutor are missing', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        end_status: null,
        package: undefined,
        contact_id: 'nobody',
        assigned_tutor_id: undefined,
      }),
      student({ id: 's-2', name: 'Sam', contact_id: 'fam-blank' }),
    ] as never);
    contactsService.getContacts.mockResolvedValue([
      contact({
        ...STAFF,
        id: 'a',
        email: 'a@x.com',
        user_group: 'Admins',
        first_name: ' ',
        last_name: 'Solo',
      }),
      contact({
        ...STAFF,
        id: 'b',
        email: 'b@x.com',
        user_group: 'Admins',
        first_name: undefined,
        last_name: undefined,
      }),
      // A contact without an id is ignored; a nameless family reads Unknown.
      contact({ id: undefined, email: 'noid@x.com' }),
      contact({ id: 'fam-blank', first_name: undefined, last_name: undefined }),
    ] as never);
    await service.sendServiceEndReminders();
    const text = textTo('a@x.com');
    expect(text).toContain('Hi Solo,');
    expect(textTo('b@x.com')).toContain('Hi Unknown,');
    expect(text).toContain('Pat (Unknown)');
    expect(text).toContain('Sam (Unknown)');
    expect(text).toContain('Then: Past Student');
    expect(text).toContain('Package: —');
    expect(text).toContain('Tutor: Unknown');
  });

  it('never writes to a former admin, skips an admin without an email, and stamps nothing when nothing is due', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    await service.sendServiceEndReminders();
    expect(recipients()).not.toContain('fay@x.com');
    expect(recipients()).toHaveLength(2);

    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({});
    studentsService.markServiceEndReminderSent.mockClear();
    studentsService.getStudents.mockResolvedValue([
      student({ end_reminder_sent: '2026-10-28' }),
    ] as never);
    await service.sendServiceEndReminders();
    expect(sentEmails()).toHaveLength(0);
    expect(stamped()).toEqual([]);
  });

  it('does nothing without SES_FROM_EMAIL, and returns early when a fetch fails', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    delete process.env.SES_FROM_EMAIL;
    await service.sendServiceEndReminders();
    expect(sentEmails()).toHaveLength(0);
    expect(stamped()).toEqual([]);

    process.env.SES_FROM_EMAIL = 'noreply@example.com';
    contactsService.getContacts.mockRejectedValue(new Error('ddb'));
    await service.sendServiceEndReminders();
    expect(sentEmails()).toHaveLength(0);
    expect(stamped()).toEqual([]);
  });

  it('stamps nothing when every send fails, stamps when at least one admin got it, and survives a failed stamp', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    sesMock.on(SendEmailCommand).rejects(new Error('ses down'));
    await service.sendServiceEndReminders();
    expect(stamped()).toEqual([]);

    sesMock.reset();
    sesMock
      .on(SendEmailCommand)
      .rejectsOnce(new Error('ses down'))
      .resolves({});
    await service.sendServiceEndReminders();
    expect(stamped()).toEqual([['s-1', '2026-10-28']]);

    studentsService.markServiceEndReminderSent.mockRejectedValue(
      new Error('ddb'),
    );
    await expect(service.sendServiceEndReminders()).resolves.toBeUndefined();
  });
});
