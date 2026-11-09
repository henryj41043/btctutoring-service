import { FamilyService } from './family.service';
import { TeamsService } from '../teams/teams.service';
import { ContactsModel } from '../models/contacts.model';
import { StudentsModel } from '../models/students.model';
import { SessionsModel } from '../models/sessions.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';

jest.mock('../models/contacts.model', () => ({
  ContactsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('../models/students.model', () => ({
  StudentsModel: require('../../test/model-mock').makeModelMock(),
}));
jest.mock('../models/sessions.model', () => ({
  SessionsModel: require('../../test/model-mock').makeModelMock(),
}));

const Contacts = ContactsModel as unknown as ModelMock;
const Students = StudentsModel as unknown as ModelMock;
const Sessions = SessionsModel as unknown as ModelMock;

const admin = {
  username: 'a',
  email: 'a@x',
  groups: ['Admins'],
  contact: 'c-admin',
};

describe('FamilyService', () => {
  const teams = { resolveTeamTutorIds: jest.fn() } as unknown as TeamsService;
  const service = new FamilyService(teams);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('an admin opens a family with no students: no session scan, no team lookup', async () => {
    scanResolves(Students, []);
    Contacts.get.mockResolvedValue({ id: 'fam-1', first_name: 'Brenda' });
    const view = await service.getFamilyView('fam-1', admin);
    expect(view.students).toEqual([]);
    expect(view.first_name).toBe('Brenda');
    expect(Sessions.scan).not.toHaveBeenCalled();
    expect(teams.resolveTeamTutorIds).not.toHaveBeenCalled();
  });

  it('propagates a failed student read', async () => {
    scanRejects(Students, new Error('scan boom'));
    await expect(service.getFamilyView('fam-1', admin)).rejects.toThrow(
      'scan boom',
    );
  });

  it('a tutor-group user without a contact id is refused', async () => {
    await expect(
      service.getFamilyView('fam-1', {
        ...admin,
        groups: ['Tutors'],
        contact: '',
      }),
    ).rejects.toThrow('Unauthorized');
    expect(Students.scan).not.toHaveBeenCalled();
  });
});
