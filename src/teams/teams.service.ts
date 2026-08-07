import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TeamsModel } from '../models/teams.model';
import { Team } from '../models/team.model';

@Injectable()
export class TeamsService {
  async getTeams(): Promise<Team[]> {
    return TeamsModel.scan()
      .all()
      .exec()
      .then((teams) => {
        return teams as unknown as Team[];
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /** The team a Lead Tutor heads, or undefined when none exists yet. */
  async getTeamByLead(contactId: string): Promise<Team | undefined> {
    return TeamsModel.scan({ lead_contact_id: { eq: contactId } })
      .all()
      .exec()
      .then((teams) => {
        return (teams as unknown as Team[])[0];
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async createTeam(team: Team) {
    await this.assertMembershipAvailable(team);
    const newUuid: string = randomUUID();
    const newTeam = new TeamsModel({
      id: newUuid,
      name: team.name,
      lead_contact_id: team.lead_contact_id,
      member_contact_ids: [...new Set(team.member_contact_ids ?? [])],
    });
    return newTeam
      .save()
      .then(() => {
        return Promise.resolve({
          id: newUuid,
          message: 'Team created successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async updateTeam(team: Team) {
    await this.assertMembershipAvailable(team);
    return TeamsModel.update(
      { id: team.id },
      {
        name: team.name,
        lead_contact_id: team.lead_contact_id,
        member_contact_ids: [...new Set(team.member_contact_ids ?? [])],
      },
    )
      .then((updated) => {
        return updated;
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  async deleteTeam(id: string) {
    return TeamsModel.delete({
      id: id,
    })
      .then(() => {
        return Promise.resolve({
          id: id,
          message: 'Team deleted successfully.',
        });
      })
      .catch((error: Error) => {
        Logger.error(error.message, error);
        return Promise.reject(error);
      });
  }

  /**
   * One-team-max invariant, enforced server-side (the app's picker disables
   * already-assigned tutors, but two concurrent admins or a stale list could
   * still double-assign without this check).
   */
  private async assertMembershipAvailable(team: Team): Promise<void> {
    if (!team.lead_contact_id) {
      throw new BadRequestException('A team lead is required.');
    }
    const members = [...new Set(team.member_contact_ids ?? [])];
    if (members.includes(team.lead_contact_id)) {
      throw new BadRequestException('The lead cannot also be a member.');
    }
    const teams = await this.getTeams();
    const assigned = new Set<string>();
    for (const other of teams) {
      if (team.id && other.id === team.id) continue; // updating this team
      if (other.lead_contact_id) assigned.add(other.lead_contact_id);
      for (const id of other.member_contact_ids ?? []) assigned.add(id);
    }
    const conflicts = [team.lead_contact_id, ...members].filter((id) =>
      assigned.has(id),
    );
    if (conflicts.length > 0) {
      throw new BadRequestException(
        `Contact(s) already assigned to another team: ${conflicts.join(', ')}`,
      );
    }
  }
}
