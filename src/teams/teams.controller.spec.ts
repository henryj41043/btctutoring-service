import { Test, TestingModule } from '@nestjs/testing';
import express from 'express';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { User } from '../models/user.model';
import { Team } from '../models/team.model';

const admin: User = {
  username: 'admin',
  email: 'admin@example.com',
  groups: ['Admins'],
  contact: 'c-admin',
};
const tutor: User = {
  username: 'tutor',
  email: 'tutor@example.com',
  groups: ['Tutors'],
  contact: 'c-tutor',
};
const lead: User = {
  username: 'lead',
  email: 'lead@example.com',
  groups: ['LeadTutors'],
  contact: 'c-lead',
};
const groupless: User = {
  username: 'nogroups',
  email: 'nogroups@example.com',
  groups: undefined as unknown as string[],
  contact: 'c-nogroups',
};
const reqAs = (user: User): express.Request =>
  ({ user }) as unknown as express.Request;

const team = {
  id: 'team-1',
  name: 'Team A',
  lead_contact_id: 'c-lead',
  member_contact_ids: ['c-tutor'],
} as Team;

describe('TeamsController', () => {
  let controller: TeamsController;
  let service: jest.Mocked<TeamsService>;

  beforeEach(async () => {
    const serviceMock: Partial<jest.Mocked<TeamsService>> = {
      getTeams: jest.fn(),
      createTeam: jest.fn(),
      updateTeam: jest.fn(),
      deleteTeam: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [{ provide: TeamsService, useValue: serviceMock }],
    }).compile();
    controller = module.get(TeamsController);
    service = module.get(TeamsService);
  });

  it('admin can list teams', async () => {
    await controller.getTeams(reqAs(admin));
    expect(service.getTeams).toHaveBeenCalled();
  });

  it('admin can create a team', async () => {
    await controller.createTeam(reqAs(admin), team);
    expect(service.createTeam).toHaveBeenCalledWith(team);
  });

  it('admin can update a team', async () => {
    await controller.updateTeam(reqAs(admin), team);
    expect(service.updateTeam).toHaveBeenCalledWith(team);
  });

  it('admin can delete a team', async () => {
    await controller.deleteTeam(reqAs(admin), 'team-1');
    expect(service.deleteTeam).toHaveBeenCalledWith('team-1');
  });

  // Leads never call the teams endpoints — their team is resolved
  // server-side inside GET /sessions. Every non-admin (including the lead
  // the team belongs to) is rejected on all four routes.
  it.each([
    ['tutor', tutor],
    ['lead', lead],
    ['groupless', groupless],
  ])('%s is rejected on every route', async (_label, user) => {
    await expect(controller.getTeams(reqAs(user))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(controller.createTeam(reqAs(user), team)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(controller.updateTeam(reqAs(user), team)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(controller.deleteTeam(reqAs(user), 'team-1')).rejects.toThrow(
      'Unauthorized',
    );
    expect(service.getTeams).not.toHaveBeenCalled();
    expect(service.createTeam).not.toHaveBeenCalled();
    expect(service.updateTeam).not.toHaveBeenCalled();
    expect(service.deleteTeam).not.toHaveBeenCalled();
  });
});
