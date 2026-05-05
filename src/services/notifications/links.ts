import {
  sleeperDraftUrlPlain,
  sleeperLeagueTeamUrlPlain,
  sleeperLeagueUrlPlain,
} from "../../domain/sleeperLinks.js";

/** Discord markdown: angle-bracket URLs suppress preview embed spam. */
export function sleeperDraftUrl(draftId: string): string {
  return `<${sleeperDraftUrlPlain(draftId)}>`;
}

export function sleeperLeagueUrl(leagueId: string): string {
  return `<${sleeperLeagueUrlPlain(leagueId)}>`;
}

export function sleeperLeagueTeamUrl(leagueId: string): string {
  return `<${sleeperLeagueTeamUrlPlain(leagueId)}>`;
}
