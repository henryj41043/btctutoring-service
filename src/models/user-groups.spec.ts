import { isCurrentAdmin, isLeadTutor, isTutorLike } from './user-groups';

describe('user-groups predicates', () => {
  it.each([
    [['Tutors'], true],
    [['LeadTutors'], true],
    [['Admins'], false],
    [[], false],
    [['Tutors', 'LeadTutors'], true],
  ])('isTutorLike(%j) -> %s', (groups, expected) => {
    expect(isTutorLike(groups)).toBe(expected);
  });

  it.each([
    [['LeadTutors'], true],
    [['Tutors'], false],
    [['Admins'], false],
    [[], false],
  ])('isLeadTutor(%j) -> %s', (groups, expected) => {
    expect(isLeadTutor(groups)).toBe(expected);
  });

  describe('isCurrentAdmin', () => {
    const staff = { user_group: 'Admins', service: 'Hiring', status: 'Staff' };
    it('accepts an Admins contact who is current staff', () => {
      expect(isCurrentAdmin(staff)).toBe(true);
    });
    it.each([
      ['not in the Admins group', { ...staff, user_group: 'Tutors' }],
      ['former staff', { ...staff, status: 'Former Staff' }],
      ['an employment inquiry', { ...staff, service: 'Employment Inquiry' }],
      ['missing the staff fields', { user_group: 'Admins' }],
    ])('rejects a contact that is %s', (_label, contact) => {
      expect(isCurrentAdmin(contact)).toBe(false);
    });
  });
});
