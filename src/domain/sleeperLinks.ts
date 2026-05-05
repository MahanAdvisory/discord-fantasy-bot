/**
 * Plain HTTPS URLs for Sleeper (web, email). Discord message formatters wrap these in angle brackets.
 */
export function sleeperDraftUrlPlain(draftId: string): string {
  return `https://sleeper.com/draft/nfl/${draftId}`;
}

export function sleeperLeagueUrlPlain(leagueId: string): string {
  return `https://sleeper.com/leagues/${leagueId}`;
}

export function sleeperLeagueTeamUrlPlain(leagueId: string): string {
  return `https://sleeper.com/leagues/${leagueId}/team`;
}
