import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FamilyController } from '../../src/family/family.controller';
import { FamilyService } from '../../src/family/family.service';
import { TeamsService } from '../../src/teams/teams.service';
import { ContactsModel } from '../../src/models/contacts.model';
import { StudentsModel } from '../../src/models/students.model';
import { SessionsModel } from '../../src/models/sessions.model';
import { TeamsModel } from '../../src/models/teams.model';
import { ModelMock, scanResolves } from '../model-mock';
import { bootIntegrationApp } from './helpers';

jest.mock('../../src/models/contacts.model', () => ({
  ContactsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/students.model', () => ({
  StudentsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/sessions.model', () => ({
  SessionsModel: require('../model-mock').makeModelMock(),
}));
jest.mock('../../src/models/teams.model', () => ({
  TeamsModel: require('../model-mock').makeModelMock(),
}));

const Contacts = ContactsModel as unknown as ModelMock;
const Students = StudentsModel as unknown as ModelMock;
const Sessions = SessionsModel as unknown as ModelMock;
const Teams = TeamsModel as unknown as ModelMock;

const family = {
  id: 'fam-1',
  first_name: 'Brenda',
  last_name: 'Deming',
  email: 'brenda@example.com',
  phone_number: '555-0100',
  address_line1: '1 Main St',
  city: 'Media',
  state: 'PA',
  zip: '19063',
  billing_cycle: 'monthly',
  sibling_discount: 10,
  inquiry_note_from_parent: 'private',
};
const staff: Record<string, object> = {
  'contact-tutor': {
    id: 'contact-tutor',
    first_name: 'Tess',
    last_name: 'Tutor',
  },
  'contact-member': {
    id: 'contact-member',
    first_name: 'Mo',
    last_name: 'Member',
  },
};
const own = {
  id: 'st-own',
  contact_id: 'fam-1',
  name: 'Charlotte',
  status: 'Active Student',
  package: 'Succeed',
  assigned_tutor_id: 'contact-tutor',
  schedule: [{ weekday: 'TUESDAY', start_time: '16:00', end_time: '16:45' }],
  make_up_minutes: 0,
  price_override: 400,
};
const sibling = {
  ...own,
  id: 'st-sib',
  name: 'Sam',
  assigned_tutor_id: 'contact-member',
};

describe('Family page (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootIntegrationApp({
      controllers: [FamilyController],
      providers: [FamilyService, TeamsService],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    scanResolves(Students, [own, sibling]);
    scanResolves(Sessions, [
      {
        student_id: 'st-own',
        start_datetime: '2026-11-20T15:00:00.000Z',
        end_datetime: '2026-11-20T15:30:00.000Z',
      },
      {
        student_id: 'st-sib',
        start_datetime: '2026-11-21T15:00:00.000Z',
        end_datetime: '2026-11-21T15:45:00.000Z',
      },
    ]);
    scanResolves(Teams, []);
    Contacts.get.mockImplementation((id: string) =>
      Promise.resolve(id === 'fam-1' ? family : staff[id]),
    );
  });

  const server = () => app.getHttpServer();

  it("a tutor opens their student's family: parent details, their student only, no billing", async () => {
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      first_name: 'Brenda',
      email: 'brenda@example.com',
      phone_number: '555-0100',
      address_line1: '1 Main St',
      city: 'Media',
    });
    expect(res.body.students).toEqual([
      expect.objectContaining({
        id: 'st-own',
        tutor_name: 'Tess Tutor',
        make_up_pending: 30,
      }),
    ]);
    const json = JSON.stringify(res.body);
    for (const leak of [
      'billing',
      'sibling_discount',
      'inquiry',
      'price_override',
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(Students.scan).toHaveBeenCalledWith({ contact_id: { eq: 'fam-1' } });
  });

  it('a tutor with no student in the family is refused, without reading the parent', async () => {
    scanResolves(Students, [sibling]);
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(403);
    expect(Contacts.get).not.toHaveBeenCalled();
  });

  it("a lead sees their team member's student in the family", async () => {
    scanResolves(Teams, [
      {
        id: 'team-1',
        lead_contact_id: 'contact-lead',
        member_contact_ids: ['contact-member'],
      },
    ]);
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'lead');
    expect(res.status).toBe(200);
    expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([
      'st-sib',
    ]);
    expect(res.body.students[0].make_up_pending).toBe(45);
  });

  it('an admin sees every student of the family', async () => {
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.students.map((s: { name: string }) => s.name)).toEqual([
      'Charlotte',
      'Sam',
    ]);
  });

  it('an admin gets 404 for a family that does not exist', async () => {
    Contacts.get.mockResolvedValue(undefined);
    const res = await request(server())
      .get('/family/missing')
      .set('x-test-role', 'admin');
    expect(res.status).toBe(404);
  });

  it('support staff and groupless users are refused before any read', async () => {
    for (const role of ['support', 'none']) {
      const res = await request(server())
        .get('/family/fam-1')
        .set('x-test-role', role);
      expect(res.status).toBe(403);
    }
    expect(Students.scan).not.toHaveBeenCalled();
  });

  it('a family with no booked make-ups shows 0 pending, without scanning sessions for none', async () => {
    scanResolves(Sessions, []);
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'tutor');
    expect(res.body.students[0].make_up_pending).toBe(0);
  });

  it('a tutor name that cannot be read is simply left out', async () => {
    Contacts.get.mockImplementation((id: string) =>
      id === 'fam-1'
        ? Promise.resolve(family)
        : Promise.reject(new Error('boom')),
    );
    const res = await request(server())
      .get('/family/fam-1')
      .set('x-test-role', 'tutor');
    expect(res.status).toBe(200);
    expect(res.body.students[0].tutor_name).toBeUndefined();
  });
});
