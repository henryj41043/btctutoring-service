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

  describe('updateStudentMakeup (tutor-scoped attendance write)', () => {
    it('writes ONLY the make-up fields — never the rest of the payload', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudentMakeup(
        sampleStudent({
          make_up_minutes: 30,
          make_up_batches: [{ minutes: 30, earned_date: '2026-09-01' }],
          package: 'Apex',
          assigned_tutor_id: 't-hax',
          custom_monthly_cost: 1,
        }),
      );
      const upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd).toEqual({
        make_up_minutes: 30,
        make_up_batches: [{ minutes: 30, earned_date: '2026-09-01' }],
      });
    });

    it('clears an explicitly emptied batch list via $REMOVE (all consumed)', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudentMakeup(
        sampleStudent({ make_up_minutes: 0, make_up_batches: [] }),
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        {
          $SET: { make_up_minutes: 0 },
          $REMOVE: ['make_up_batches'],
        },
      );
    });

    it('filters malformed batch entries and tolerates absent fields', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudentMakeup(
        sampleStudent({
          make_up_minutes: undefined,
          make_up_batches: [
            null,
            { minutes: 15, earned_date: '2026-09-01' },
          ] as never,
        }),
      );
      const upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd).toEqual({
        make_up_batches: [{ minutes: 15, earned_date: '2026-09-01' }],
      });
    });

    it('rejects when the update fails', async () => {
      Model.update.mockRejectedValue(new Error('makeup boom'));
      await expect(
        service.updateStudentMakeup(sampleStudent({ make_up_minutes: 10 })),
      ).rejects.toThrow('makeup boom');
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

    it('persists per-tutor planning overrides, filters malformed entries, clears on []', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          extra_planning_by_tutor: [
            null,
            { tutor_id: 't-1', minutes: 15 },
          ] as never,
        }),
      );
      let upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd['extra_planning_by_tutor']).toEqual([
        { tutor_id: 't-1', minutes: 15 },
      ]);

      await service.updateStudent(
        sampleStudent({ extra_planning_by_tutor: [] }),
      );
      const cleared = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(cleared.$REMOVE).toContain('extra_planning_by_tutor');
      expect(cleared.$SET).not.toHaveProperty('extra_planning_by_tutor');

      // Absent field: neither written nor removed (stored overrides survive).
      await service.updateStudent(sampleStudent());
      upd = Model.update.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(upd).not.toHaveProperty('extra_planning_by_tutor');
      expect(upd).not.toHaveProperty('$REMOVE');
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

    it('persists a sanitized scheduled-change list and removes the legacy scalars, with no $SET overlap', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          pending_changes: [
            {
              package: 'Succeed',
              effective: '2027-01-01',
              custom_monthly_cost: null as unknown as number,
            },
            {
              package: 'Achieve',
              effective: '2026-09-01',
              schedule: [
                { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
              ],
            },
          ],
        }),
      );
      const update = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(update.$SET.pending_changes).toEqual([
        {
          package: 'Achieve',
          effective: '2026-09-01',
          schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          ],
        },
        { package: 'Succeed', effective: '2027-01-01' },
      ]);
      expect(update.$REMOVE).toEqual([
        'pending_package',
        'pending_custom_monthly_cost',
        'pending_custom_sessions_per_week',
        'pending_custom_session_length_min',
        'pending_package_effective',
        'pending_schedule',
        'pending_change_notice_sent',
      ]);
      for (const field of update.$REMOVE) {
        expect(update.$SET).not.toHaveProperty(field);
      }
      expect(update.$SET.name).toBe('Pat');
    });

    it('an empty list clears every scheduled change (attribute removed, legacy scalars too)', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(sampleStudent({ pending_changes: [] }));
      const update = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(update.$REMOVE).toContain('pending_changes');
      expect(update.$REMOVE).toContain('pending_package');
      expect(update.$SET).not.toHaveProperty('pending_changes');
    });

    it("still honours an old app's legacy signals: '' clears, a filled scalar pair becomes a one-entry list", async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({
          pending_package: '',
          pending_package_effective: '2026-09-01',
        }),
      );
      let update = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(update.$REMOVE).toContain('pending_changes');
      expect(update.$SET).not.toHaveProperty('pending_package');

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
      update = Model.update.mock.calls.at(-1)![1] as {
        $SET: Record<string, unknown>;
        $REMOVE: string[];
      };
      expect(update.$SET.pending_changes).toEqual([
        {
          package: 'Achieve',
          effective: '2026-09-01',
          custom_monthly_cost: 500,
          schedule: [
            { weekday: 'MONDAY', start_time: '10:00', end_time: '10:30' },
          ],
        },
      ]);
      expect(update.$REMOVE).toContain('pending_package');
      expect(update.$SET).not.toHaveProperty('pending_package');
      expect(update.$SET).not.toHaveProperty('pending_schedule');
    });

    it('leaves the scheduled changes alone when the payload carries no pending keys', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.updateStudent(
        sampleStudent({ pending_package: 'Achieve' }),
      ); // no effective → not a signal
      const update = Model.update.mock.calls.at(-1)![1] as Record<
        string,
        unknown
      >;
      expect(update).not.toHaveProperty('$REMOVE');
      expect(update).not.toHaveProperty('pending_changes');
      expect(update).not.toHaveProperty('pending_package');
    });

    describe('custom price and discount', () => {
      const lastUpdate = () => Model.update.mock.calls.at(-1)![1];

      it('persists a custom price, a discount and its trimmed reason', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          price_override: 410.4,
          discount_percent: 10,
          discount_reason: '  Staff family  ',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          price_override: 410.4,
          discount_percent: 10,
          discount_reason: 'Staff family',
        });
      });

      it('accepts a $0 custom price and a 100% discount', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          price_override: 0,
          discount_percent: 100,
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          price_override: 0,
          discount_percent: 100,
        });
      });

      it('null clears the custom price and the discount with its reason', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          name: 'Pat',
          price_override: null,
          discount_percent: null,
          discount_reason: 'old',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          $SET: { name: 'Pat' },
          $REMOVE: ['price_override', 'discount_percent', 'discount_reason'],
        });
      });

      it('a 0% discount is a clear, never stored', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          discount_percent: 0,
          discount_reason: 'old',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          $SET: {},
          $REMOVE: ['discount_percent', 'discount_reason'],
        });
      });

      it.each([[''], ['   '], [null]])(
        'a blanked reason (%p) is removed while the discount stays',
        async (reason) => {
          Model.update.mockResolvedValue({});
          await service.updateStudent({
            id: 's-1',
            discount_percent: 10,
            discount_reason: reason,
          } as unknown as Student);
          expect(lastUpdate()).toEqual({
            $SET: { discount_percent: 10 },
            $REMOVE: ['discount_reason'],
          });
        },
      );

      it('an absent reason leaves the stored one alone', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          discount_percent: 10,
        } as unknown as Student);
        expect(lastUpdate()).toEqual({ discount_percent: 10 });
      });

      it('never stores a reason without a discount', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          discount_reason: 'orphan',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({});
        await service.updateStudent({
          id: 's-1',
          discount_reason: '',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({});
      });

      it('a non-string reason is dropped', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          discount_percent: 10,
          discount_reason: 5,
        } as unknown as Student);
        expect(lastUpdate()).toEqual({ discount_percent: 10 });
      });

      it.each([[-1], [NaN], [Infinity], ['5'], [true]])(
        'rejects the custom price %p before writing',
        async (price) => {
          await expect(
            service.updateStudent({
              id: 's-1',
              price_override: price,
            } as unknown as Student),
          ).rejects.toThrow(
            'price_override must be a non-negative number, or null to clear.',
          );
          expect(Model.update).not.toHaveBeenCalled();
        },
      );

      it.each([[-1], [100.01], [NaN], [Infinity], ['10'], [true]])(
        'rejects the discount %p before writing',
        async (percent) => {
          await expect(
            service.updateStudent({
              id: 's-1',
              discount_percent: percent,
            } as unknown as Student),
          ).rejects.toThrow(
            'discount_percent must be between 0 and 100, or null to clear.',
          );
          expect(Model.update).not.toHaveBeenCalled();
        },
      );

      it('createStudent validates and stores the same fields', async () => {
        Model.__save.mockResolvedValue({});
        await service.createStudent({
          name: 'Pat',
          price_override: 300,
          discount_percent: 5,
          discount_reason: 'Referral',
        } as unknown as Student);
        expect(Model.mock.calls.at(-1)![0]).toEqual(
          expect.objectContaining({
            price_override: 300,
            discount_percent: 5,
            discount_reason: 'Referral',
          }),
        );
        await service.createStudent({
          name: 'Pat',
          price_override: null,
          discount_percent: 0,
          discount_reason: 'x',
        } as unknown as Student);
        const saved = Model.mock.calls.at(-1)![0];
        expect(saved).not.toHaveProperty('price_override');
        expect(saved).not.toHaveProperty('discount_percent');
        expect(saved).not.toHaveProperty('discount_reason');
        await expect(
          service.createStudent({
            name: 'Pat',
            discount_percent: 101,
          } as unknown as Student),
        ).rejects.toThrow('discount_percent must be between 0 and 100');
      });
    });

    describe('service end date', () => {
      const lastUpdate = () => Model.update.mock.calls.at(-1)![1];

      it('persists an end date with its end status', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          service_end_date: '2026-10-15',
          end_status: 'MIA',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          service_end_date: '2026-10-15',
          end_status: 'MIA',
        });
      });

      it('never stores an end status without an end date', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          end_status: 'MIA',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({});
      });

      it('a null end date clears it with its end status', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          service_end_date: null,
          end_status: 'MIA',
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          $SET: {},
          $REMOVE: ['service_end_date', 'end_status'],
        });
      });

      it('a null end status alone is removed', async () => {
        Model.update.mockResolvedValue({});
        await service.updateStudent({
          id: 's-1',
          service_end_date: '2026-10-15',
          end_status: null,
        } as unknown as Student);
        expect(lastUpdate()).toEqual({
          $SET: { service_end_date: '2026-10-15' },
          $REMOVE: ['end_status'],
        });
      });

      it.each([
        ['2026-10-15T00:00:00'],
        ['10/15/2026'],
        ['2026-13-40'],
        ['x2026-10-15'],
        [''],
        [20261015],
      ])('rejects the end date %p before writing', async (end) => {
        await expect(
          service.updateStudent({
            id: 's-1',
            service_end_date: end,
          } as unknown as Student),
        ).rejects.toThrow(
          'service_end_date must be formatted YYYY-MM-DD, or null to clear.',
        );
        expect(Model.update).not.toHaveBeenCalled();
      });

      it.each([['Active Student'], ['Onboarding'], ['Gone'], [''], [5]])(
        'rejects the end status %p before writing',
        async (status) => {
          await expect(
            service.updateStudent({
              id: 's-1',
              service_end_date: '2026-10-15',
              end_status: status,
            } as unknown as Student),
          ).rejects.toThrow(
            'end_status must be one of: Past Student, MIA, Declined Services.',
          );
          expect(Model.update).not.toHaveBeenCalled();
        },
      );

      it('createStudent validates the same fields', async () => {
        await expect(
          service.createStudent({
            name: 'Pat',
            service_end_date: 'tomorrow',
          } as unknown as Student),
        ).rejects.toThrow('service_end_date must be formatted YYYY-MM-DD');
      });
    });

    describe('applyServiceEnd', () => {
      it.each([
        ['MIA', 'MIA'],
        ['Declined Services', 'Declined Services'],
        ['Past Student', 'Past Student'],
        [undefined, 'Past Student'],
        [null, 'Past Student'],
        ['Active Student', 'Past Student'],
      ])('end status %p moves the student to %s', async (end, expected) => {
        Model.update.mockResolvedValue({});
        const status = await service.applyServiceEnd({
          id: 's-1',
          end_status: end,
        } as unknown as Student);
        expect(status).toBe(expected);
        expect(Model.update).toHaveBeenCalledWith(
          { id: 's-1' },
          { status: expected },
        );
      });

      it('rejects when the update fails', async () => {
        Model.update.mockRejectedValue(new Error('boom'));
        await expect(
          service.applyServiceEnd({ id: 's-1' } as unknown as Student),
        ).rejects.toThrow('boom');
      });
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

  describe('markPendingChangeNoticeSent', () => {
    it('stamps the matching entry, rewriting the list and removing legacy scalars', async () => {
      Model.update.mockResolvedValue(undefined);
      await service.markPendingChangeNoticeSent(
        sampleStudent({
          pending_changes: [
            { package: 'Succeed', effective: '2027-01-01' },
            { package: 'Excel', effective: '2026-10-01' },
          ],
        }),
        '2026-10-01',
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'student-1' },
        {
          $SET: {
            pending_changes: [
              {
                package: 'Excel',
                effective: '2026-10-01',
                notice_sent: '2026-10-01',
              },
              { package: 'Succeed', effective: '2027-01-01' },
            ],
          },
          $REMOVE: [
            'pending_package',
            'pending_custom_monthly_cost',
            'pending_custom_sessions_per_week',
            'pending_custom_session_length_min',
            'pending_package_effective',
            'pending_schedule',
            'pending_change_notice_sent',
          ],
        },
      );
    });

    it('converges a legacy-shaped student on the list while stamping', async () => {
      Model.update.mockResolvedValue(undefined);
      await service.markPendingChangeNoticeSent(
        sampleStudent({
          pending_package: 'Excel',
          pending_package_effective: '2026-10-01',
        }),
        '2026-10-01',
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET.pending_changes).toEqual([
        {
          package: 'Excel',
          effective: '2026-10-01',
          notice_sent: '2026-10-01',
        },
      ]);
    });

    it('rejects when the write fails', async () => {
      Model.update.mockRejectedValue(new Error('write boom'));
      await expect(
        service.markPendingChangeNoticeSent(sampleStudent(), '2026-10-01'),
      ).rejects.toThrow('write boom');
    });
  });

  describe('promotePendingChanges', () => {
    const monday = {
      weekday: 'MONDAY',
      start_time: '10:00',
      end_time: '10:30',
    };
    const pendingStudent = (overrides: Partial<Student> = {}): Student =>
      sampleStudent({
        package: 'Succeed',
        custom_monthly_cost: 111,
        custom_sessions_per_week: 1,
        custom_session_length_min: 30,
        pending_changes: [
          { package: 'Achieve', effective: '2026-09-01', schedule: [monday] },
        ],
        ...overrides,
      });
    const LEGACY = [
      'pending_package',
      'pending_custom_monthly_cost',
      'pending_custom_sessions_per_week',
      'pending_custom_session_length_min',
      'pending_package_effective',
      'pending_schedule',
      'pending_change_notice_sent',
    ];

    it('promotes a non-CUSTOM change: package, wall-stamped start, schedule; removes the list, legacy scalars + stale customs', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingChanges(pendingStudent(), '2026-09-01');
      const [key, update] = Model.update.mock.calls.at(-1)!;
      expect(key).toEqual({ id: 'student-1' });
      expect(update.$SET).toEqual({
        package: 'Achieve',
        // Zoneless local-wall stamp — never a bare 'YYYY-MM-DD'.
        package_start_date: '2026-09-01T00:00:00',
        schedule: [monday],
      });
      expect(update.$REMOVE).toEqual([
        ...LEGACY,
        'pending_changes',
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
      ]);
    });

    it('is a no-op when nothing is due', async () => {
      await service.promotePendingChanges(pendingStudent(), '2026-08-01');
      await service.promotePendingChanges(sampleStudent(), '2026-09-01');
      expect(Model.update).not.toHaveBeenCalled();
    });

    it('applies several due changes in one write: last wins, future entries written back', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      const tuesday = {
        weekday: 'TUESDAY',
        start_time: '10:00',
        end_time: '10:30',
      };
      await service.promotePendingChanges(
        pendingStudent({
          pending_changes: [
            { package: 'Excel', effective: '2026-12-01' },
            { package: 'Achieve', effective: '2026-09-01', schedule: [monday] },
            { package: 'Apex', effective: '2026-10-01', schedule: [tuesday] },
            { package: 'Thrive', effective: '2026-11-01' },
          ],
        }),
        '2026-11-01',
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).toEqual({
        package: 'Thrive',
        package_start_date: '2026-11-01T00:00:00',
        schedule: [tuesday],
        pending_changes: [{ package: 'Excel', effective: '2026-12-01' }],
      });
      expect(update.$REMOVE).toEqual([
        ...LEGACY,
        'custom_monthly_cost',
        'custom_sessions_per_week',
        'custom_session_length_min',
      ]);
    });

    it('promotes a CUSTOM change with its overrides, keeping custom fields set', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingChanges(
        pendingStudent({
          pending_changes: [
            {
              package: 'Custom',
              effective: '2026-09-01',
              custom_monthly_cost: 500,
              custom_sessions_per_week: 2,
              custom_session_length_min: 45,
            },
          ],
        }),
        '2026-09-01',
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
      expect(update.$SET).not.toHaveProperty('schedule');
      expect(update.$REMOVE).not.toContain('custom_monthly_cost');
      expect(update.$REMOVE).toContain('pending_changes');
    });

    it('drops undefined CUSTOM overrides rather than writing them', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingChanges(
        pendingStudent({
          pending_changes: [
            {
              package: 'Custom',
              effective: '2026-09-01',
              custom_monthly_cost: 500,
            },
          ],
        }),
        '2026-09-01',
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET).toHaveProperty('custom_monthly_cost', 500);
      expect(update.$SET).not.toHaveProperty('custom_sessions_per_week');
      expect(update.$SET).not.toHaveProperty('custom_session_length_min');
    });

    it('promotes a legacy-shaped student (read fallback)', async () => {
      Model.update.mockResolvedValue(sampleStudent());
      await service.promotePendingChanges(
        sampleStudent({
          package: 'Succeed',
          pending_package: 'Achieve',
          pending_package_effective: '2026-09-01',
        }),
        '2026-09-01',
      );
      const [, update] = Model.update.mock.calls.at(-1)!;
      expect(update.$SET.package).toBe('Achieve');
      expect(update.$REMOVE).toContain('pending_package');
    });

    it('propagates a failed promotion write', async () => {
      Model.update.mockRejectedValue(new Error('promote boom'));
      await expect(
        service.promotePendingChanges(pendingStudent(), '2026-09-01'),
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
