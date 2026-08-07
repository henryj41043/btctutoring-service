import { isLeadTutor, isTutorLike } from './user-groups';

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
});
