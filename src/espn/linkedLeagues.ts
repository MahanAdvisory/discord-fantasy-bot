/** Normalized ESPN league ids stored on User.espnLeagueIds (JSON array). */
export function espnLeagueIdsFromJson(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => String(x).trim()).filter(Boolean))];
}

export type EspnLinkFields = {
  espnLeagueIds: unknown;
  espnTeamByLeague?: unknown;
  espnSeason: string | null;
  espnS2: string | null;
  espnSwid: string | null;
};

/** Map ESPN league id -> your team id in that league (from ESPN roster URL or API). */
export function espnTeamByLeagueFromJson(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const leagueKey = String(k).trim();
    if (!leagueKey) continue;
    const tid = typeof v === "number" ? v : Number.parseInt(String(v).trim(), 10);
    if (Number.isFinite(tid)) out[leagueKey] = tid;
  }
  return out;
}

export function espnTeamIdForLeague(map: Record<string, number>, leagueId: string): number | undefined {
  const v = map[leagueId.trim()];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function espnSeasonOrDefault(user: EspnLinkFields, nflSeason: string): string {
  return user.espnSeason?.trim() || nflSeason;
}
