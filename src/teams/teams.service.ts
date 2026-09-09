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
   * Every tutor contact id a lead may see, resolved transitively: the lead's
   * own team members, plus — for any member who heads a team of their own —
   * that team's members, and so on (nested teams, client policy 2026-09: a
   * Head Tutor's team lists a Lead, and thereby the Lead's whole team).
   * Breadth-first over one scan of the teams table; a visited set makes it
   * cycle-safe and dedupes. Never includes the lead themself (the caller
   * adds user.contact so a mis-pointed record can't widen access). Returns
   * [] when the lead heads no team.
   */
  async resolveTeamTutorIds(leadContactId: string): Promise<string[]> {
    const teams = await this.getTeams();
    const teamByLead = new Map<string, Team>();
    for (const t of teams) {
      if (t.lead_contact_id && !teamByLead.has(t.lead_contact_id)) {
        teamByLead.set(t.lead_contact_id, t);
      }
    }
    if (!teamByLead.has(leadContactId)) return [];
    const seenLeads = new Set<string>([leadContactId]);
    const tutors = new Set<string>();
    const queue: string[] = [leadContactId];
    // Bounded by the number of teams — each lead is expanded at most once.
    while (queue.length > 0) {
      const lead = queue.shift() as string;
      for (const member of teamByLead.get(lead)?.member_contact_ids ?? []) {
        if (!member || member === leadContactId) continue;
        tutors.add(member);
        if (teamByLead.has(member) && !seenLeads.has(member)) {
          seenLeads.add(member);
          queue.push(member);
        }
      }
    }
    return [...tutors];
  }

  /**
   * Membership invariants, enforced server-side (two concurrent admins or a
   * stale list could otherwise slip past the app's picker):
   * - a lead is required and is never a member of their own team;
   * - a lead heads AT MOST ONE team (getTeamByLead / the resolver key on it);
   * - members may belong to several teams, and a lead may be a member of
   *   another team (nested teams — that team's lead then sees theirs too).
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
    const headsAnother = teams.some(
      (other) =>
        !(team.id && other.id === team.id) && // updating this team
        other.lead_contact_id === team.lead_contact_id,
    );
    if (headsAnother) {
      throw new BadRequestException(
        `Contact already leads another team: ${team.lead_contact_id}`,
      );
    }
  }
}
