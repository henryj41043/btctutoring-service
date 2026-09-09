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

  describe('resolveTeamTutorIds (nested teams)', () => {
    const jenna = team({
      id: 't-jenna',
      lead_contact_id: 'c-jenna',
      member_contact_ids: ['c-emily', 'c-solo'],
    });
    const emily = team({
      id: 't-emily',
      lead_contact_id: 'c-emily',
      member_contact_ids: ['c-m1', 'c-m2'],
    });

    it("returns the lead's members plus, transitively, the members of any member who leads a team", async () => {
      scanResolves(Model, [emily, jenna]);
      await expect(service.resolveTeamTutorIds('c-jenna')).resolves.toEqual([
        'c-emily',
        'c-solo',
        'c-m1',
        'c-m2',
      ]);
      // Emily's own read stays her team only — nesting flows downward.
      await expect(service.resolveTeamTutorIds('c-emily')).resolves.toEqual([
        'c-m1',
        'c-m2',
      ]);
    });

    it('is cycle-safe and dedupes (A lists B, B lists A and a shared tutor)', async () => {
      scanResolves(Model, [
        team({
          id: 'a',
          lead_contact_id: 'c-a',
          member_contact_ids: ['c-b', 'c-shared'],
        }),
        team({
          id: 'b',
          lead_contact_id: 'c-b',
          member_contact_ids: ['c-a', 'c-shared', 'c-m1'],
        }),
      ]);
      await expect(service.resolveTeamTutorIds('c-a')).resolves.toEqual([
        'c-b',
        'c-shared',
        'c-m1',
      ]);
    });

    it('never includes the lead themself, even when mis-listed as a member', async () => {
      scanResolves(Model, [team({ member_contact_ids: ['c-lead', 'c-m1'] })]);
      await expect(service.resolveTeamTutorIds('c-lead')).resolves.toEqual([
        'c-m1',
      ]);
    });

    it('returns [] when the lead heads no team, or an empty one', async () => {
      scanResolves(Model, [emily]);
      await expect(service.resolveTeamTutorIds('c-nobody')).resolves.toEqual(
        [],
      );
      scanResolves(Model, [
        team({ member_contact_ids: undefined as unknown as string[] }),
      ]);
      await expect(service.resolveTeamTutorIds('c-lead')).resolves.toEqual([]);
    });

    it('ignores records with no lead and blank member ids', async () => {
      scanResolves(Model, [
        team({
          id: 'x',
          lead_contact_id: undefined,
          member_contact_ids: ['c-ghost'],
        }),
        team({ member_contact_ids: ['', 'c-m1'] }),
      ]);
      await expect(service.resolveTeamTutorIds('c-lead')).resolves.toEqual([
        'c-m1',
      ]);
    });

    it('rejects when the scan fails', async () => {
      scanRejects(Model, new Error('scan boom'));
      await expect(service.resolveTeamTutorIds('c-lead')).rejects.toThrow(
        'scan boom',
      );
    });
  });

  describe('membership validation', () => {
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

    it('rejects when the lead already heads another team (a lead heads at most one)', async () => {
      scanResolves(Model, [team({ id: 'other-team' })]);
      await expect(
        service.createTeam(team({ id: undefined, member_contact_ids: [] })),
      ).rejects.toThrow('Contact already leads another team: c-lead');
      expect(Model.__save).not.toHaveBeenCalled();
    });

    it('allows a member who already belongs to another team (multi-team membership)', async () => {
      scanResolves(Model, [
        team({ id: 'other-team', lead_contact_id: 'c-other-lead' }),
      ]);
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createTeam(
        team({
          id: undefined,
          lead_contact_id: 'c-new-lead',
          member_contact_ids: ['c-m2', 'c-free'],
        }),
      );
      expect(result.message).toBe('Team created successfully.');
    });

    it("allows another team's lead as a member (nested teams)", async () => {
      scanResolves(Model, [team({ id: 'other-team', member_contact_ids: [] })]);
      Model.__save.mockResolvedValue(undefined);
      const result = await service.createTeam(
        team({
          id: undefined,
          lead_contact_id: 'c-new-lead',
          member_contact_ids: ['c-lead'],
        }),
      );
      expect(result.message).toBe('Team created successfully.');
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
