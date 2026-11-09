import { Contact } from '../models/contact.model';
import { Student } from '../models/student.model';
import {
  buildFamilyView,
  FamilyViewer,
  studentInScope,
  tutorIdsOf,
} from './family-view';

const NOW = new Date('2026-11-09T12:00:00.000Z');

const contact = (over: Partial<Contact> = {}): Contact =>
  ({
    id: 'fam-1',
    first_name: 'Brenda',
    last_name: 'Deming',
    email: 'brenda@example.com',
    phone_number: '555-0100',
    address_line1: '1 Main St',
    address_line2: 'Apt 2',
    city: 'Media',
    state: 'PA',
    zip: '19063',
    // Never part of the family page:
    billing_cycle: 'monthly',
    sibling_discount: 10,
    scholarship_name: 'Fund',
    cc_authorization_received: true,
    hourly_rate: 30,
    ...over,
  }) as unknown as Contact;

const student = (over: Partial<Student> = {}): Student =>
  ({
    id: 'st-1',
    contact_id: 'fam-1',
    name: 'Charlotte',
    status: 'Active Student',
    package: 'Succeed',
    assigned_tutor_id: 't-1',
    schedule: [{ weekday: 'TUESDAY', start_time: '16:00', end_time: '16:45' }],
    make_up_batches: [{ minutes: 45, earned_date: '2026-11-01T12:00:00.000Z' }],
    // Never part of the family page:
    price_override: 400,
    discount_percent: 15,
    ...over,
  }) as unknown as Student;

const tutor: FamilyViewer = {
  isAdmin: false,
  contactId: 't-1',
  teamTutorIds: [],
};
const names = new Map([
  ['t-1', 'Karrie Tillotson'],
  ['t-2', 'Kelly Holmes'],
]);

describe('family-view', () => {
  describe('studentInScope', () => {
    it('an admin sees every student, whatever the status', () => {
      const admin = { isAdmin: true, contactId: 'a', teamTutorIds: [] };
      expect(
        studentInScope(
          student({ status: 'Past Student', assigned_tutor_id: 'x' }),
          admin,
        ),
      ).toBe(true);
    });

    it('a tutor sees their own current students, assigned or by slot', () => {
      expect(studentInScope(student(), tutor)).toBe(true);
      expect(studentInScope(student({ status: 'Onboarding' }), tutor)).toBe(
        true,
      );
      expect(
        studentInScope(
          student({
            assigned_tutor_id: 't-9',
            schedule: [
              {
                weekday: 'MONDAY',
                start_time: '1',
                end_time: '2',
                tutor_id: 't-1',
              },
            ],
          }),
          tutor,
        ),
      ).toBe(true);
    });

    it("a tutor does not see past or inactive students, or someone else's", () => {
      for (const status of [
        'Past Student',
        'MIA',
        'Declined Services',
        undefined,
      ]) {
        expect(studentInScope(student({ status }), tutor)).toBe(false);
      }
      expect(studentInScope(student({ assigned_tutor_id: 't-2' }), tutor)).toBe(
        false,
      );
    });

    it("a lead sees their team's students too", () => {
      const lead = {
        isAdmin: false,
        contactId: 't-lead',
        teamTutorIds: ['t-2'],
      };
      expect(studentInScope(student({ assigned_tutor_id: 't-2' }), lead)).toBe(
        true,
      );
      expect(studentInScope(student({ assigned_tutor_id: 't-3' }), lead)).toBe(
        false,
      );
    });

    it('a viewer with no contact id sees nobody', () => {
      expect(
        studentInScope(student({ assigned_tutor_id: '' }), {
          ...tutor,
          contactId: '',
        }),
      ).toBe(false);
    });
  });

  describe('buildFamilyView', () => {
    it('returns the parent details and only whitelisted student fields', () => {
      const view = buildFamilyView(
        contact(),
        [student()],
        tutor,
        new Map([['st-1', 30]]),
        names,
        NOW,
      );
      expect(view).toEqual({
        id: 'fam-1',
        first_name: 'Brenda',
        last_name: 'Deming',
        email: 'brenda@example.com',
        phone_number: '555-0100',
        address_line1: '1 Main St',
        address_line2: 'Apt 2',
        city: 'Media',
        state: 'PA',
        zip: '19063',
        students: [
          {
            id: 'st-1',
            name: 'Charlotte',
            status: 'Active Student',
            package: 'Succeed',
            assigned_tutor_id: 't-1',
            tutor_name: 'Karrie Tillotson',
            schedule: [
              { weekday: 'TUESDAY', start_time: '16:00', end_time: '16:45' },
            ],
            make_up_available: 45,
            make_up_pending: 30,
            make_up_never_expire: false,
          },
        ],
      });
      const json = JSON.stringify(view);
      for (const leak of [
        'billing',
        'sibling',
        'scholarship',
        'cc_',
        'hourly',
        'price',
        'discount',
      ]) {
        expect(json).not.toContain(leak);
      }
    });

    it('leaves out siblings outside the scope and sorts the rest by name', () => {
      const view = buildFamilyView(
        contact(),
        [
          student({ id: 'st-2', name: 'Zoe' }),
          student({ id: 'st-3', name: 'Other', assigned_tutor_id: 't-2' }),
          student({ id: 'st-1', name: 'Abe' }),
          student({ id: undefined, name: 'No id' }),
        ],
        tutor,
        new Map(),
        names,
        NOW,
      );
      expect(view.students.map((s) => s.name)).toEqual(['Abe', 'Zoe']);
      expect(view.students[0].make_up_pending).toBe(0);
    });

    it('names slot tutors and tolerates missing fields', () => {
      const view = buildFamilyView(
        contact({ address_line2: undefined, zip: 12345 as unknown as string }),
        [
          student({
            name: undefined,
            package: undefined,
            assigned_tutor_id: undefined,
            make_up_never_expire: true,
            schedule: [
              {
                weekday: 'MONDAY',
                start_time: '10:00',
                end_time: '10:30',
                tutor_id: 't-1',
              },
              {
                weekday: 'FRIDAY',
                start_time: '11:00',
                end_time: '11:30',
                tutor_id: 't-x',
              },
            ],
          }),
        ],
        { isAdmin: true, contactId: 'a', teamTutorIds: [] },
        new Map(),
        names,
        NOW,
      );
      expect(view.address_line2).toBe('');
      expect(view.zip).toBe('');
      const [s] = view.students;
      expect(s.name).toBe('');
      expect(s.package).toBe('');
      expect(s.tutor_name).toBeUndefined();
      expect(s.make_up_never_expire).toBe(true);
      expect(s.schedule).toEqual([
        {
          weekday: 'MONDAY',
          start_time: '10:00',
          end_time: '10:30',
          tutor_id: 't-1',
          tutor_name: 'Karrie Tillotson',
        },
        {
          weekday: 'FRIDAY',
          start_time: '11:00',
          end_time: '11:30',
          tutor_id: 't-x',
          tutor_name: undefined,
        },
      ]);
    });

    it('a student with no schedule shows an empty one', () => {
      const view = buildFamilyView(
        contact(),
        [student({ schedule: undefined })],
        tutor,
        new Map(),
        names,
        NOW,
      );
      expect(view.students[0].schedule).toEqual([]);
    });
  });

  it('tutorIdsOf collects assigned and slot tutors once each', () => {
    expect(
      tutorIdsOf([
        student(),
        student({
          assigned_tutor_id: undefined,
          schedule: [
            {
              weekday: 'MONDAY',
              start_time: '1',
              end_time: '2',
              tutor_id: 't-2',
            },
            {
              weekday: 'MONDAY',
              start_time: '1',
              end_time: '2',
              tutor_id: 't-1',
            },
          ],
        }),
        student({ schedule: undefined }),
      ]),
    ).toEqual(['t-1', 't-2']);
  });
});
