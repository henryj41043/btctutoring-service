import { Test, TestingModule } from '@nestjs/testing';
import { StudentsService } from './students.service';
import { StudentsModel } from '../models/students.model';
import { ContactsModel } from '../models/contacts.model';
import { Student } from '../models/student.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/students.model', () => ({
  StudentsModel: require('../../test/model-mock').makeModelMock(),
}));

jest.mock('../models/contacts.model', () => ({
  ContactsModel: require('../../test/model-mock').makeModelMock(),
}));

const Model = StudentsModel as unknown as ModelMock;
const Contacts = ContactsModel as unknown as ModelMock;

const sampleStudent = (overrides: Partial<Student> = {}): Student =>
  ({
    id: 'student-1',
    contact_id: 'contact-1',
    name: 'Pat',
    birthday: '2015-05-05',
    status: 'Active Student',
    assigned_tutor_id: 'tutor@example.com',
    package: 'Standard',
    available_minutes: 120,
    make_up_minutes: 0,
    ...overrides,
  }) as Student;

describe('StudentsService', () => {
  let service: StudentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StudentsService],
    }).compile();
    service = module.get<StudentsService>(StudentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('read queries', () => {
    it('getStudent gets by key and wraps the item in an array', async () => {
      const student = sampleStudent();
      Model.get.mockResolvedValue(student);
      await expect(service.getStudent('student-1')).resolves.toEqual([student]);
      expect(Model.get).toHaveBeenCalledWith('student-1');
    });

    it('getStudent returns an empty array for a missing id', async () => {
      Model.get.mockResolvedValue(undefined);
      await expect(service.getStudent('missing')).resolves.toEqual([]);
    });

    it('getStudent rejects when the get fails', async () => {
      Model.get.mockRejectedValue(new Error('get boom'));
      await expect(service.getStudent('x')).rejects.toThrow('get boom');
    });

    it('getStudentsByContact scans by contact_id', async () => {
      scanResolves(Model, []);
      await service.getStudentsByContact('contact-1');
      expect(Model.scan).toHaveBeenCalledWith({
        contact_id: { eq: 'contact-1' },
      });
    });

    it('getStudentsByTutor includes primary and slot-tutored students only', async () => {
      scanResolves(Model, [
        sampleStudent({ id: 'primary', assigned_tutor_id: 't-1' }),
        sampleStudent({
          id: 'slot-secondary',
          assigned_tutor_id: 't-2',
          schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
            {
              weekday: 'WEDNESDAY',
              start_time: '16:00',
              end_time: '16:45',
              tutor_id: 't-1',
            },
          ],
        }),
        sampleStudent({ id: 'other', assigned_tutor_id: 't-2' }),
        // Regression: slots without tutor_id never match a non-primary tutor.
        sampleStudent({
          id: 'no-override',
          assigned_tutor_id: 't-2',
          schedule: [
            { weekday: 'FRIDAY', start_time: '09:00', end_time: '09:30' },
          ],
        }),
        // Malformed slot entries must not throw.
        sampleStudent({
          id: 'malformed',
          assigned_tutor_id: 't-2',
          schedule: [undefined as never],
        }),
      ]);
      const result = (await service.getStudentsByTutor('t-1')) as {
        id: string;
      }[];
      // Widened predicate runs in code over an unfiltered scan.
      expect(Model.scan).toHaveBeenCalledWith();
      expect(result.map((r) => r.id)).toEqual(['primary', 'slot-secondary']);
    });

    it('getStudents scans everything', async () => {
      scanResolves(Model, []);
      await service.getStudents();
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it.each([
      ['getStudentsByContact', () => service.getStudentsByContact('x')],
      ['getStudentsByTutor', () => service.getStudentsByTutor('x')],
      ['getStudents', () => service.getStudents()],
    ])('%s rejects when the scan fails', async (_name, call) => {
      scanRejects(Model, new Error('scan boom'));
      await expect(call()).rejects.toThrow('scan boom');
    });
  });

  describe('createStudent', () => {
    it('saves a student and returns a generated id', async () => {
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createStudent(sampleStudent());
      expect(Model.__save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Student created successfully.',
      });
    });

    it('rejects when save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createStudent(sampleStudent())).rejects.toThrow(
        'save boom',
      );
    });

    it('strips null/invalid optional fields before saving (regression: schedule [null] 500)', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.createStudent(
        sampleStudent({
          schedule: [null] as never,
          package_start_date: null as never,
          custom_monthly_cost: null as never,
          auto_renew: null as never,
        }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs).not.toHaveProperty('schedule');
      expect(attrs).not.toHaveProperty('package_start_date');
      expect(attrs).not.toHaveProperty('custom_monthly_cost');
      expect(attrs).not.toHaveProperty('auto_renew');
      expect(attrs.contact_id).toBe('contact-1');
    });

    it('keeps a valid schedule', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.createStudent(
        sampleStudent({
          schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          ],
        }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs.schedule).toHaveLength(1);
    });

    it('defaults status to Onboarding and onboarding_complete to false when absent', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.createStudent(
        sampleStudent({
          status: undefined as never,
          onboarding_complete: undefined as never,
        }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs.status).toBe('Onboarding');
      expect(attrs.onboarding_complete).toBe(false);
    });

    it('keeps an explicitly provided status and onboarding_complete', async () => {
      Model.__save.mockResolvedValue(undefined);
      await service.createStudent(
        sampleStudent({ status: 'Active Student', onboarding_complete: true }),
      );
      const attrs = (Model as unknown as jest.Mock).mock.calls.at(-1)![0];
      expect(attrs.status).toBe('Active Student');
      expect(attrs.onboarding_complete).toBe(true);
    });
  });

  describe('withContactNames', () => {
    beforeEach(() => {
      Contacts.batchGet.mockReset();
    });

    it('joins each student to their family display name + email (deduped lookup)', async () => {
      Contacts.batchGet.mockResolvedValue([
        {
          id: 'c1',
          first_name: 'Ann',
          last_name: 'Lee',
          email: 'ann@example.com',
        },
        // last_name + email absent — trimmed name, blank email.
        { id: 'c2', first_name: 'Bob' },
      ]);
      const rows = await service.withContactNames([
        sampleStudent({ id: 's1', contact_id: 'c1', name: 'Kid One' }),
        sampleStudent({ id: 's2', contact_id: 'c1', name: 'Kid Two' }), // sibling — same contact
        sampleStudent({ id: 's3', contact_id: 'c2', name: 'Kid Three' }),
        sampleStudent({ id: 's4', contact_id: '' as never, name: 'No Family' }),
      ]);
      // Sibling ids deduped before the batchGet; falsy ids dropped.
      expect(Contacts.batchGet).toHaveBeenCalledWith(['c1', 'c2']);
      expect(rows.map((r) => r.contact_name)).toEqual([
        'Ann Lee',
        'Ann Lee',
        'Bob',
        '',
      ]);
      expect(rows.map((r) => r.contact_email)).toEqual([
        'ann@example.com',
        'ann@example.com',
        '',
        '',
      ]);
      // The student's own fields survive the merge.
      expect(rows[0].name).toBe('Kid One');
      expect(rows[0].id).toBe('s1');
    });

    it('returns empty contact fields when the contact is missing', async () => {
      Contacts.batchGet.mockResolvedValue([]);
      const rows = await service.withContactNames([
        sampleStudent({ id: 's1', contact_id: 'c-gone' }),
      ]);
      expect(rows[0].contact_name).toBe('');
      expect(rows[0].contact_email).toBe('');
    });

    it('skips the lookup entirely for an empty list', async () => {
      const rows = await service.withContactNames([]);
      expect(rows).toEqual([]);
      expect(Contacts.batchGet).not.toHaveBeenCalled();
    });
  });

  describe('getOnboardingStudents', () => {
    beforeEach(() => {
      Contacts.batchGet.mockReset();
    });

    it('prefers the per-student trial date and falls back to the contact date', async () => {
      scanResolves(Model, [
        sampleStudent({
          id: 's-own',
          contact_id: 'c1',
          status: 'Onboarding',
          trial_date: '2026-08-20',
        }),
        sampleStudent({
          id: 's-legacy',
          contact_id: 'c1',
          status: 'Onboarding',
          trial_date: undefined,
        }),
      ]);
      const contactTrial = new Date('2026-08-01T00:00:00.000Z');
      Contacts.batchGet.mockResolvedValue([
        { id: 'c1', first_name: 'Ann', trial_date: contactTrial },
        { id: 'tutor@example.com', first_name: 'Tess' },
      ]);

      const rows = await service.getOnboardingStudents();

      expect(rows[0].trial_date).toBe('2026-08-20');
      expect(rows[1].trial_date).toBe(contactTrial);
    });

    it('leaves tutor_name empty for an unassigned student', async () => {
      scanResolves(Model, [
        sampleStudent({
          id: 's-unassigned',
          contact_id: 'c1',
          status: 'Onboarding',
          assigned_tutor_id: undefined as never,
        }),
      ]);
      Contacts.batchGet.mockResolvedValue([{ id: 'c1', first_name: 'Ann' }]);

      const rows = await service.getOnboardingStudents();

      expect(Contacts.batchGet).toHaveBeenCalledWith(['c1']);
      expect(rows[0].tutor_name).toBe('');
    });

    it('scans onboarding students and joins their family name + onboarding dates', async () => {
      const inquiry = new Date('2026-01-05T00:00:00.000Z');
      const consult = new Date('2026-02-01T00:00:00.000Z');
      scanResolves(Model, [
        sampleStudent({
          id: 's1',
          contact_id: 'c1',
          name: 'Kid One',
          status: 'Onboarding',
          onboarding_complete: true,
        }),
        sampleStudent({
          id: 's2',
          contact_id: 'c2',
          name: 'Kid Two',
          status: 'Onboarding',
          onboarding_complete: undefined as never,
        }),
        sampleStudent({
          id: 's3',
          contact_id: 'c3',
          name: 'Kid Three',
          status: 'Onboarding',
        }),
        // Falsy contact_id must be dropped from the batchGet key set.
        sampleStudent({
          id: 's4',
          contact_id: '' as never,
          name: 'Kid Four',
          status: 'Onboarding',
        }),
      ]);
      Contacts.batchGet.mockResolvedValue([
        {
          id: 'c1',
          first_name: 'Ann',
          last_name: 'Lee',
          inquiry_received: inquiry,
          consult_date: consult,
          scholarship_name: 'Fund',
          scholarship_student: true,
          twenty_five_received: true,
        },
        // last_name absent — the trimmed join must not leave a trailing space.
        { id: 'c2', first_name: 'Bob' },
        // first_name absent — the leading gap must be trimmed too.
        { id: 'c3', last_name: 'Solo' },
        // Malformed batchGet results (null / missing id) must be skipped.
        null,
        { first_name: 'No Id' },
        // The assigned tutor is joined from the same batchGet.
        { id: 'tutor@example.com', first_name: 'Tess', last_name: 'Coach' },
      ]);

      const rows = await service.getOnboardingStudents();

      expect(Model.scan).toHaveBeenCalledWith({
        status: { eq: 'Onboarding' },
      });
      expect(Contacts.batchGet).toHaveBeenCalledWith([
        'c1',
        'c2',
        'c3',
        'tutor@example.com',
      ]);
      expect(rows).toHaveLength(4);

      expect(rows[0]).toMatchObject({
        id: 's1',
        contact_id: 'c1',
        name: 'Kid One',
        onboarding_complete: true,
        contact_name: 'Ann Lee',
        tutor_name: 'Tess Coach',
        inquiry_received: inquiry,
        consult_date: consult,
        scholarship_name: 'Fund',
        scholarship_student: true,
        twenty_five_received: true,
      });
      // Missing onboarding_complete defaults to false; single-name family trims.
      expect(rows[1]).toMatchObject({
        contact_name: 'Bob',
        onboarding_complete: false,
      });
      // Family with only a last name — leading space trimmed.
      expect(rows[2]).toMatchObject({
        contact_name: 'Solo',
        onboarding_complete: false,
      });
      expect(rows[2].inquiry_received).toBeUndefined();
      // Falsy contact_id → no lookup → empty name.
      expect(rows[3]).toMatchObject({
        contact_name: '',
        onboarding_complete: false,
      });
    });

    it('returns an empty list and skips the contact lookup when nobody is onboarding', async () => {
      scanResolves(Model, []);
      const rows = await service.getOnboardingStudents();
      expect(rows).toEqual([]);
      expect(Contacts.batchGet).not.toHaveBeenCalled();
    });

    it('rejects when the student scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getOnboardingStudents()).rejects.toThrow(
        'scan boom',
      );
    });
  });

  describe('updateStudent', () => {
    it('updates and returns the student', async () => {
      const updated = sampleStudent({ status: 'Inactive' });
      Model.update.mockResolvedValue(updated);
      const result = await service.updateStudent(sampleStudent());
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({ name: 'Pat' }),
      );
      expect(result).toBe(updated);
    });

    it('strips null optional fields on update (regression)', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          schedule: null as never,
          package_start_date: null as never,
          custom_session_length_min: null as never,
        }),
      );
      const upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd).not.toHaveProperty('schedule');
      expect(upd).not.toHaveProperty('package_start_date');
      expect(upd).not.toHaveProperty('custom_session_length_min');
    });

    it('issues a $REMOVE to clear an explicitly emptied schedule', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ schedule: [] }));
      const update = Model.update.mock.calls.at(-1)![1] as {
        $SET?: Record<string, unknown>;
        $REMOVE?: string[];
      };
      expect(update.$REMOVE).toEqual(['schedule']);
      expect(update.$SET).not.toHaveProperty('schedule');
    });

    it('persists the scheduled-package-change fields', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          pending_package: 'Achieve',
          pending_package_effective: '2026-09-01',
          pending_custom_monthly_cost: 500,
          pending_schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          ],
        }),
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({
          pending_package: 'Achieve',
          pending_package_effective: '2026-09-01',
          pending_custom_monthly_cost: 500,
          pending_schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          ],
        }),
      );
    });

    it('drops an empty pending_schedule from the write', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({ pending_package: 'Achieve', pending_schedule: [] }),
      );
      const upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd).not.toHaveProperty('pending_schedule');
    });

    it('clears every pending field on the empty-string signal, with no $SET overlap', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          pending_package: '',
          pending_package_effective: '2026-09-01',
          pending_custom_monthly_cost: 500,
        }),
      );
      const update = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(update.$REMOVE).toEqual([
        'pending_package',
        'pending_custom_monthly_cost',
        'pending_custom_sessions_per_week',
        'pending_custom_session_length_min',
        'pending_package_effective',
        'pending_schedule',
      ]);
      // DynamoDB rejects overlapping SET/REMOVE paths — none may remain.
      for (const field of update.$REMOVE) {
        expect(update.$SET).not.toHaveProperty(field);
      }
      expect(update.$SET.name).toBe('Pat'); // the rest of the save still lands
    });

    it('persists the scholarship flag', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ scholarship: true }));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({ scholarship: true }),
      );
    });

    it('persists the BTC & Me enrollment flag', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ btc_and_me: true }));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({ btc_and_me: true }),
      );
    });

    it('persists the onboarding_complete flag', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ onboarding_complete: true }));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({ onboarding_complete: true }),
      );
    });

    it('persists the mid-month package-change fields', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          mid_month_prior_charge: 88.5,
          mid_month_change_period: '2026-07',
        }),
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        expect.objectContaining({
          mid_month_prior_charge: 88.5,
          mid_month_change_period: '2026-07',
        }),
      );
    });

    it('persists make-up batches (filtering malformed entries) and the never-expire flag', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          make_up_batches: [
            { minutes: 30, earned_date: '2026-07-01T00:00:00Z' },
            null as never,
          ],
          make_up_never_expire: true,
        }),
      );
      const attrs = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect(attrs.make_up_batches).toEqual([
        { minutes: 30, earned_date: '2026-07-01T00:00:00Z' },
      ]);
      expect(attrs.make_up_never_expire).toBe(true);
    });

    it('persists extra_planning_minutes (payroll per-session credit)', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({ extra_planning_minutes: 15 }),
      );
      const attrs = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect(attrs.extra_planning_minutes).toBe(15);
    });

    it('issues a $REMOVE to clear an explicitly emptied make-up batch list', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ make_up_batches: [] }));
      const update = Model.update.mock.calls.at(-1)![1] as {
        $SET?: Record<string, unknown>;
        $REMOVE?: string[];
      };
      expect(update.$REMOVE).toEqual(['make_up_batches']);
      expect(update.$SET).not.toHaveProperty('make_up_batches');
    });

    it('rejects when update fails', async () => {
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateStudent(sampleStudent())).rejects.toThrow(
        'update boom',
      );
    });
  });

  describe('promotePendingPackage', () => {
    const pendingStudent = (overrides: Partial<Student> = {}): Student =>
      sampleStudent({
        package: 'Succeed',
        custom_monthly_cost: 111,
        custom_sessions_per_week: 1,
        custom_session_length_min: 30,
        pending_package: 'Achieve',
        pending_package_effective: '2026-09-01',
        pending_schedule: [
          { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
        ],
        ...overrides,
      });

    it('promotes a non-CUSTOM pending: package, wall-stamped start, schedule; removes pending + stale customs', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingPackage(pendingStudent());
      const [key, update] = Model.update.mock.calls.at(-1)!;
      expect(key).toEqual({ id: 'student-1' });
      expect(update.$SET).toEqual({
        package: 'Achieve',
        // Zoneless local-wall stamp — never a bare 'YYYY-MM-DD'.
        package_start_date: '2026-09-01T00:00:00',
        schedule: [
          { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
        ],
      });
      expect(update.$REMOVE).toEqual([
        'pending_package',
        'pending_custom_monthly_cost',
        'pending_custom_sessions_per_week',
        'pending_custom_session_length_min',
        'pending_package_effective',
        'pending_schedule',
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
      ]);
    });

    it('promotes a CUSTOM pending with its overrides, keeping custom fields set', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingPackage(
        pendingStudent({
          pending_package: 'Custom',
          pending_custom_monthly_cost: 500,
          pending_custom_sessions_per_week: 2,
          pending_custom_session_length_min: 45,
        }),
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).toEqual(
        expect.objectContaining({
          package: 'Custom',
          custom_monthly_cost: 500,
          custom_sessions_per_week: 2,
          custom_session_length_min: 45,
        }),
      );
      expect(update.$REMOVE).not.toContain('custom_monthly_cost');
    });

    it('keeps the old schedule when no pending schedule was defined', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingPackage(
        pendingStudent({ pending_schedule: undefined }),
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).not.toHaveProperty('schedule');
      expect(update.$REMOVE).toContain('pending_schedule');
    });

    it('drops undefined CUSTOM overrides rather than writing them', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingPackage(
        pendingStudent({
          pending_package: 'Custom',
          pending_custom_monthly_cost: 500,
          pending_custom_sessions_per_week: undefined,
          pending_custom_session_length_min: undefined,
        }),
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).toHaveProperty('custom_monthly_cost', 500);
      expect(update.$SET).not.toHaveProperty('custom_sessions_per_week');
      expect(update.$SET).not.toHaveProperty('custom_session_length_min');
    });

    it('propagates a failed promotion write', async () => {
      Model.update.mockRejectedValue(new Error('promote boom'));
      await expect(
        service.promotePendingPackage(pendingStudent()),
      ).rejects.toThrow('promote boom');
    });
  });

  describe('deleteStudent', () => {
    it('deletes the student and returns a confirmation', async () => {
      Model.delete.mockResolvedValue(undefined);
      await expect(service.deleteStudent('student-1')).resolves.toEqual({
        id: 'student-1',
        message: 'Student deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'student-1' });
    });

    it('rejects when delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteStudent('student-1')).rejects.toThrow(
        'delete boom',
      );
    });
  });
});
