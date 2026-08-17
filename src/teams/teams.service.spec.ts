import { TeamsService } from './teams.service';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';
import { Team } from '../models/team.model';

jest.mock('../models/teams.model', () => ({
  TeamsModel: require('../../test/model-mock').makeModelMock(),
}));

const { TeamsModel: Model } = require('../models/teams.model') as {
  TeamsModel: ModelMock;
};

const team = (over: Partial<Team> = {}): Team =>
  ({
    id: 'team-1',
    name: 'Team A',
    lead_contact_id: 'c-lead',
    member_contact_ids: ['c-m1', 'c-m2'],
    ...over,
  }) as Team;

describe('TeamsService', () => {
  let service: TeamsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    service = new TeamsService();
  });

  describe('getTeams', () => {
    it('returns every team from a full scan', async () => {
      scanResolves(Model, [team()]);
      await expect(service.getTeams()).resolves.toEqual([team()]);
      expect(Model.scan).toHaveBeenCalledWith();
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.getTeams()).rejects.toThrow('scan boom');
    });
  });

  describe('getTeamByLead', () => {
    it('scans by lead_contact_id and returns the first team', async () => {
      scanResolves(Model, [team()]);
      await expect(service.getTeamByLead('c-lead')).resolves.toEqual(team());
      expect(Model.scan).toHaveBeenCalledWith({
        lead_contact_id: { eq: 'c-lead' },
      });
    });

    it('returns undefined when the lead heads no team', async () => {
      scanResolves(Model, []);
      await expect(service.getTeamByLead('c-lead')).resolves.toBeUndefined();
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('lead boom'));
      await expect(service.getTeamByLead('c-lead')).rejects.toThrow(
        'lead boom',
      );
    });
  });

  describe('createTeam', () => {
    beforeEach(() => {
      scanResolves(Model, []); // no existing teams — validation passes
      Model.__save.mockResolvedValue(undefined);
    });

    it('saves a new team with a generated id and deduped members', async () => {
      const result = await service.createTeam(
        team({ id: undefined, member_contact_ids: ['c-m1', 'c-m1', 'c-m2'] }),
      );
      expect(Model).toHaveBeenCalledWith({
        id: expect.any(String),
        name: 'Team A',
        lead_contact_id: 'c-lead',
        member_contact_ids: ['c-m1', 'c-m2'],
      });
      expect(result).toEqual({
        id: expect.any(String),
        message: 'Team created successfully.',
      });
    });

    it('allows an empty member list (members added later)', async () => {
      const result = await service.createTeam(
        team({ id: undefined, member_contact_ids: [] }),
      );
      expect(result.message).toBe('Team created successfully.');
    });

    it('treats a missing member list as empty', async () => {
      await service.createTeam(
        team({
          id: undefined,
          member_contact_ids: undefined as unknown as string[],
        }),
      );
      expect(Model).toHaveBeenCalledWith(
        expect.objectContaining({ member_contact_ids: [] }),
      );
    });

    it('rejects when the save fails', async () => {
      Model.__save.mockRejectedValue(new Error('save boom'));
      await expect(service.createTeam(team({ id: undefined }))).rejects.toThrow(
        'save boom',
      );
    });
  });

  describe('updateTeam', () => {
    it('updates name, lead, and deduped members by id', async () => {
      scanResolves(Model, [team()]); // only this team exists — no conflict
      Model.update.mockResolvedValue(team());
      await service.updateTeam(team({ member_contact_ids: ['c-m1', 'c-m1'] }));
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'team-1' },
        {
          name: 'Team A',
          lead_contact_id: 'c-lead',
          member_contact_ids: ['c-m1'],
        },
      );
    });

    it('rejects when the update fails', async () => {
      scanResolves(Model, []);
      Model.update.mockRejectedValue(new Error('update boom'));
      await expect(service.updateTeam(team())).rejects.toThrow('update boom');
    });

    it('treats a missing member list as empty on update', async () => {
      scanResolves(Model, []);
      Model.update.mockResolvedValue(team());
      await service.updateTeam(
        team({ member_contact_ids: undefined as unknown as string[] }),
      );
      expect(Model.update).toHaveBeenCalledWith(
        { id: 'team-1' },
        expect.objectContaining({ member_contact_ids: [] }),
      );
    });
  });

  describe('one-team-max validation', () => {
    it('rejects a team without a lead', async () => {
      await expect(
        service.createTeam(team({ id: undefined, lead_contact_id: '' })),
      ).rejects.toThrow('A team lead is required.');
      expect(Model.__save).not.toHaveBeenCalled();
    });

    it('rejects when the lead is also listed as a member', async () => {
      await expect(
        service.createTeam(
          team({ id: undefined, member_contact_ids: ['c-lead', 'c-m1'] }),
        ),
      ).rejects.toThrow('The lead cannot also be a member.');
    });

    it('rejects when the lead already heads another team', async () => {
      scanResolves(Model, [team({ id: 'other-team' })]);
      await expect(
        service.createTeam(team({ id: undefined, member_contact_ids: [] })),
      ).rejects.toThrow('Contact(s) already assigned to another team: c-lead');
    });

    it('rejects when a member belongs to another team, naming the id', async () => {
      scanResolves(Model, [
        team({ id: 'other-team', lead_contact_id: 'c-other-lead' }),
      ]);
      await expect(
        service.createTeam(
          team({
            id: undefined,
            lead_contact_id: 'c-new-lead',
            member_contact_ids: ['c-m2', 'c-free'],
          }),
        ),
      ).rejects.toThrow('Contact(s) already assigned to another team: c-m2');
    });

    it('rejects when a member is another team lead', async () => {
      scanResolves(Model, [team({ id: 'other-team', member_contact_ids: [] })]);
      await expect(
        service.createTeam(
          team({
            id: undefined,
            lead_contact_id: 'c-new-lead',
            member_contact_ids: ['c-lead'],
          }),
        ),
      ).rejects.toThrow('Contact(s) already assigned to another team: c-lead');
    });

    it('ignores the team being updated when checking conflicts', async () => {
      scanResolves(Model, [team()]); // the same team, same members
      Model.update.mockResolvedValue(team());
      await expect(service.updateTeam(team())).resolves.toEqual(team());
    });

    it('tolerates existing teams with missing member lists', async () => {
      scanResolves(Model, [
        team({
          id: 'other-team',
          lead_contact_id: 'c-other-lead',
          member_contact_ids: undefined as unknown as string[],
        }),
      ]);
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createTeam(
        team({
          id: undefined,
          lead_contact_id: 'c-new',
          member_contact_ids: [],
        }),
      );
      expect(result.message).toBe('Team created successfully.');
    });
  });

  describe('deleteTeam', () => {
    it('deletes by id', async () => {
      Model.delete.mockResolvedValue(undefined);
      await expect(service.deleteTeam('team-1')).resolves.toEqual({
        id: 'team-1',
        message: 'Team deleted successfully.',
      });
      expect(Model.delete).toHaveBeenCalledWith({ id: 'team-1' });
    });

    it('rejects when the delete fails', async () => {
      Model.delete.mockRejectedValue(new Error('delete boom'));
      await expect(service.deleteTeam('team-1')).rejects.toThrow('delete boom');
    });
  });
});
