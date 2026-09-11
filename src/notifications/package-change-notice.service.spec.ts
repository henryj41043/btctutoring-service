import { Test, TestingModule } from '@nestjs/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import {
  NOTICE_DAYS_AHEAD,
  PackageChangeNoticeService,
} from './package-change-notice.service';
import { StudentsService } from '../students/students.service';
import { ContactsService } from '../contacts/contacts.service';
import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';

const sesMock = mockClient(SESClient);

// 9am ET on 2026-09-10 → today = 2026-09-10, horizon = 2026-09-24.
const NOW = new Date('2026-09-10T13:00:00Z');

const contact = (over: Partial<Contact>): Contact =>
  ({ first_name: 'X', last_name: 'Y', ...over }) as Contact;
const adminA = contact({
  id: 'admin-a',
  first_name: 'Ada',
  last_name: 'Admin',
  email: 'ada@x.com',
  user_group: 'Admins',
});
const adminNoEmail = contact({
  id: 'admin-b',
  first_name: 'Bo',
  last_name: 'Blank',
  user_group: 'Admins',
});
const tutor1 = contact({
  id: 't-1',
  first_name: 'Tess',
  last_name: 'One',
  email: 'tess@x.com',
  user_group: 'Tutors',
});
const tutor2 = contact({
  id: 't-2',
  first_name: 'Tim',
  last_name: 'Two',
  email: 'tim@x.com',
  user_group: 'Tutors',
});
const family = contact({
  id: 'fam-1',
  first_name: 'Kay',
  last_name: 'Roe',
  email: 'kay@x.com',
});
const contacts = [adminA, adminNoEmail, tutor1, tutor2, family];

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: 's-1',
    name: 'Pat',
    contact_id: 'fam-1',
    status: 'Active Student',
    assigned_tutor_id: 't-1',
    package: 'Thrive',
    pending_changes: [{ package: 'Excel', effective: '2026-09-24' }],
    ...over,
  }) as Student;
const change = (over: Record<string, unknown> = {}) => ({
  package: 'Excel',
  effective: '2026-09-24',
  ...over,
});

describe('PackageChangeNoticeService', () => {
  let service: PackageChangeNoticeService;
  let studentsService: jest.Mocked<StudentsService>;
  let contactsService: jest.Mocked<ContactsService>;

  const sentEmails = () =>
    sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
  const bodyTo = (email: string): string =>
    sentEmails().find((i) => i.Destination?.ToAddresses?.[0] === email)?.Message
      ?.Body?.Text?.Data ?? '';

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
        PackageChangeNoticeService,
        {
          provide: StudentsService,
          useValue: {
            getStudents: jest.fn().mockResolvedValue([]),
            markPendingChangeNoticeSent: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContactsService,
          useValue: { getContacts: jest.fn().mockResolvedValue(contacts) },
        },
      ],
    }).compile();
    service = module.get(PackageChangeNoticeService);
    studentsService = module.get(StudentsService);
    contactsService = module.get(ContactsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('announces a change due within 14 days to every admin and the effective tutors, then stamps it', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        pending_changes: [
          change({
            schedule: [
              { weekday: 'MONDAY', start_time: '16:00', end_time: '16:45' },
              {
                weekday: 'THURSDAY',
                start_time: '09:05',
                end_time: '09:50',
                tutor_id: 't-2',
              },
            ],
          }),
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();

    const to = sentEmails()
      .map((i) => i.Destination?.ToAddresses?.[0])
      .sort();
    expect(to).toEqual(['ada@x.com', 'tess@x.com', 'tim@x.com']); // admin-b has no email
    const email = sentEmails()[0];
    expect(email.Source).toBe('noreply@example.com');
    expect(email.Message?.Subject?.Data).toBe(
      'Upcoming package change: Pat on Sep 24, 2026',
    );
    const body = bodyTo('ada@x.com');
    expect(body).toContain('Hi Ada,');
    expect(body).toContain('Pat (Kay Roe)');
    expect(body).toContain('Current package: Thrive');
    expect(body).toContain('New package: Excel');
    expect(body).toContain('Effective: Sep 24, 2026');
    expect(body).toContain(
      'New weekly schedule: Mon 4:00 PM–4:45 PM, Thu 9:05 AM–9:50 AM (Tim Two)',
    );
    expect(body).not.toContain('⚠');
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      '2026-09-24',
    );
  });

  it('warns when no pending schedule is set (the current schedule carries over)', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    await service.sendPackageChangeNotices();
    const body = bodyTo('ada@x.com');
    expect(body).toContain('⚠ No new schedule has been set.');
    expect(body).toContain(
      'set the pending schedule via Manage Schedule before Sep 24, 2026',
    );
    expect(body).not.toContain('New weekly schedule');
  });

  it('describes a pending Custom package with its overrides', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        pending_changes: [
          change({
            package: 'Custom',
            custom_monthly_cost: 400,
            custom_sessions_per_week: 2,
            custom_session_length_min: 45,
          }),
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    expect(bodyTo('ada@x.com')).toContain(
      'New package: Custom ($400/mo, 2×45 min)',
    );
  });

  it('includes slot tutors of the CURRENT schedule and dedupes an assigned tutor who is also a slot tutor', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        schedule: [
          {
            weekday: 'MONDAY',
            start_time: '16:00',
            end_time: '16:30',
            tutor_id: 't-1',
          },
          {
            weekday: 'TUESDAY',
            start_time: '16:00',
            end_time: '16:30',
            tutor_id: 't-2',
          },
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    const to = sentEmails()
      .map((i) => i.Destination?.ToAddresses?.[0])
      .sort();
    expect(to).toEqual(['ada@x.com', 'tess@x.com', 'tim@x.com']);
  });

  it('sends one digest per recipient covering several changes, with a count subject', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({ id: 's-1', name: 'Pat' }),
      student({
        id: 's-2',
        name: 'Sam',
        assigned_tutor_id: 't-2',
        pending_changes: [change({ effective: '2026-09-15' })],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    expect(sentEmails()).toHaveLength(3); // admin + 2 tutors
    const admin = sentEmails().find(
      (i) => i.Destination?.ToAddresses?.[0] === 'ada@x.com',
    );
    expect(admin?.Message?.Subject?.Data).toBe('2 upcoming package changes');
    expect(bodyTo('ada@x.com')).toContain('Pat (Kay Roe)');
    expect(bodyTo('ada@x.com')).toContain('Sam (Kay Roe)');
    // Each tutor only hears about their own student.
    expect(bodyTo('tess@x.com')).toContain('Pat');
    expect(bodyTo('tess@x.com')).not.toContain('Sam');
    expect(bodyTo('tim@x.com')).toContain('Sam');
    expect(bodyTo('tim@x.com')).not.toContain('Pat');
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledTimes(
      2,
    );
  });

  it.each([
    [
      'effective today',
      { pending_changes: [change({ effective: '2026-09-10' })] },
    ],
    [
      'effective in the past',
      { pending_changes: [change({ effective: '2026-09-01' })] },
    ],
    [
      'beyond the 14-day horizon',
      { pending_changes: [change({ effective: '2026-09-25' })] },
    ],
    [
      'already announced for this effective date',
      { pending_changes: [change({ notice_sent: '2026-09-24' })] },
    ],
    ['not an active student', { status: 'Onboarding' }],
    ['no pending changes', { pending_changes: [] }],
    [
      'no pending changes at all (legacy scalars absent)',
      { pending_changes: undefined },
    ],
  ])('sends nothing when %s', async (_label, over) => {
    studentsService.getStudents.mockResolvedValue([
      student(over as Partial<Student>),
    ] as never);
    await service.sendPackageChangeNotices();
    expect(sentEmails()).toHaveLength(0);
    expect(studentsService.markPendingChangeNoticeSent).not.toHaveBeenCalled();
  });

  it('announces on the boundary day (exactly 14 days out) and re-announces a re-dated change', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({ pending_changes: [change({ notice_sent: '2026-09-15' })] }),
    ] as never);
    await service.sendPackageChangeNotices();
    expect(sentEmails().length).toBeGreaterThan(0);
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      '2026-09-24',
    );
    expect(NOTICE_DAYS_AHEAD).toBe(14);
  });

  it('announces per queued entry: a stamped entry is skipped, a later out-of-horizon one waits, the prior package is the previous step', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        pending_changes: [
          change({ effective: '2026-09-15', notice_sent: '2026-09-15' }), // already announced
          change({ package: 'Succeed', effective: '2026-09-24' }), // due now; prior step = Excel
          change({ package: 'Apex', effective: '2026-12-01' }), // beyond horizon
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    const body = bodyTo('ada@x.com');
    expect(body).toContain('Current package: Excel');
    expect(body).toContain('New package: Succeed');
    expect(body).not.toContain('Apex');
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledTimes(
      1,
    );
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      '2026-09-24',
    );
  });

  it('announces a legacy-shaped student (read fallback) and unions slot tutors across every queued schedule', async () => {
    studentsService.getStudents.mockResolvedValue([
      student({
        pending_changes: undefined,
        pending_package: 'Excel',
        pending_package_effective: '2026-09-24',
      }),
      student({
        id: 's-2',
        name: 'Sam',
        pending_changes: [
          change({ effective: '2026-09-20' }),
          change({
            package: 'Apex',
            effective: '2027-03-01',
            schedule: [
              {
                weekday: 'MONDAY',
                start_time: '16:00',
                end_time: '16:30',
                tutor_id: 't-2',
              },
            ],
          }),
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    expect(bodyTo('ada@x.com')).toContain('Pat (Kay Roe)');
    // t-2 only tutors Sam's far-future entry, yet hears about Sam's September change.
    expect(bodyTo('tim@x.com')).toContain('Sam');
    expect(bodyTo('tim@x.com')).not.toContain('Pat');
  });

  it('does nothing (and stamps nothing) without SES_FROM_EMAIL', async () => {
    delete process.env.SES_FROM_EMAIL;
    studentsService.getStudents.mockResolvedValue([student()] as never);
    await service.sendPackageChangeNotices();
    expect(studentsService.getStudents).not.toHaveBeenCalled();
    expect(sentEmails()).toHaveLength(0);
    expect(studentsService.markPendingChangeNoticeSent).not.toHaveBeenCalled();
  });

  it('returns early when fetching students or contacts fails', async () => {
    studentsService.getStudents.mockRejectedValue(new Error('db down'));
    await service.sendPackageChangeNotices();
    expect(sentEmails()).toHaveLength(0);
    studentsService.getStudents.mockResolvedValue([student()] as never);
    contactsService.getContacts.mockRejectedValue(new Error('db down'));
    await service.sendPackageChangeNotices();
    expect(sentEmails()).toHaveLength(0);
  });

  it('leaves a change unstamped when every send for it fails, stamps it when at least one succeeds', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    sesMock.on(SendEmailCommand).rejects(new Error('ses down'));
    await service.sendPackageChangeNotices();
    expect(studentsService.markPendingChangeNoticeSent).not.toHaveBeenCalled();

    sesMock.reset();
    sesMock
      .on(SendEmailCommand)
      .rejectsOnce(new Error('ses hiccup'))
      .resolves({});
    await service.sendPackageChangeNotices();
    expect(studentsService.markPendingChangeNoticeSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      '2026-09-24',
    );
  });

  it('logs and continues when stamping fails', async () => {
    studentsService.getStudents.mockResolvedValue([student()] as never);
    studentsService.markPendingChangeNoticeSent.mockRejectedValue(
      new Error('write failed'),
    );
    await expect(service.sendPackageChangeNotices()).resolves.toBeUndefined();
    expect(sentEmails().length).toBeGreaterThan(0);
  });

  it('falls back to a full name / Unknown for sparse contacts and skips unknown weekday labels gracefully', async () => {
    contactsService.getContacts.mockResolvedValue([
      contact({
        id: 'admin-a',
        first_name: '',
        last_name: 'Admin',
        email: 'ada@x.com',
        user_group: 'Admins',
      }),
    ] as never);
    studentsService.getStudents.mockResolvedValue([
      student({
        contact_id: 'nobody',
        assigned_tutor_id: undefined,
        pending_changes: [
          change({
            schedule: [{ weekday: 'FUNDAY', start_time: 'bad', end_time: '' }],
          }),
        ],
      }),
    ] as never);
    await service.sendPackageChangeNotices();
    const body = bodyTo('ada@x.com');
    expect(body).toContain('Hi Admin,');
    expect(body).toContain('Pat (Unknown)');
    expect(body).toContain('New weekly schedule: FUNDAY bad–');
  });
});
