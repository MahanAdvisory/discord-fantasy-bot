/**
 * Sprint 1 spike scaffold for ESPN unofficial integration.
 *
 * This module intentionally remains read-only + best-effort while we validate
 * endpoint stability and payload shape drift.
 */

export interface EspnLeagueSnapshot {
  leagueId: string;
  name: string;
  season: string;
  status: string;
}

export interface EspnRecentActivityEvent {
  eventId: string;
  createdAtMs: number;
  type: "waiver" | "free_agent" | "trade" | "other";
  summary: string;
}

export interface EspnRosterBuckets {
  starters: string[];
  bench: string[];
  reserve: string[];
}

export interface EspnTeamRosterSnapshot {
  teamId: number;
  teamName: string;
  buckets: EspnRosterBuckets;
}

export interface EspnDraftStatusSnapshot {
  status: "drafting" | "complete" | "pre_draft" | "unknown";
  currentPick?: number | null;
  onTheClockTeam?: string | null;
  reason: string;
}

export function espnEnabled(): boolean {
  return process.env.ESPN_UNOFFICIAL_ENABLED === "true";
}

function espnLeagueUrl(season: string, leagueId: string, views: string[]): string {
  const q = views.map((v) => `view=${encodeURIComponent(v)}`).join("&");
  return `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${q}`;
}

function parseEspnType(code: unknown): EspnRecentActivityEvent["type"] {
  // Community observed values: 178/179 waiver/fa; 244 trade (can vary by season/product).
  const n = typeof code === "number" ? code : Number.NaN;
  if (n === 178 || n === 179) return "waiver";
  if (n === 180) return "free_agent";
  if (n === 244) return "trade";
  return "other";
}

function playerNameMap(players: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(players)) return out;
  for (const p of players) {
    if (!p || typeof p !== "object") continue;
    const obj = p as { id?: number; fullName?: string };
    if (typeof obj.id === "number" && typeof obj.fullName === "string" && obj.fullName.trim()) {
      out.set(obj.id, obj.fullName.trim());
    }
  }
  return out;
}

function teamNameMap(teams: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(teams)) return out;
  for (const t of teams) {
    if (!t || typeof t !== "object") continue;
    const obj = t as { id?: number; name?: string; location?: string; nickname?: string };
    if (typeof obj.id !== "number") continue;
    const nm =
      obj.name?.trim() ||
      `${obj.location ?? ""} ${obj.nickname ?? ""}`.trim() ||
      `team ${obj.id}`;
    out.set(obj.id, nm);
  }
  return out;
}

function slotBucket(lineupSlotId: number | null): keyof EspnRosterBuckets {
  if (lineupSlotId == null) return "bench";
  // ESPN commonly uses 20 for bench; IR and taxi-like slots vary by league rules.
  if (lineupSlotId === 20) return "bench";
  if ([21, 22, 23, 88].includes(lineupSlotId)) return "reserve";
  return "starters";
}

function normalizeTeamRosters(raw: unknown): EspnTeamRosterSnapshot[] {
  if (!raw || typeof raw !== "object") return [];
  const rec = raw as { teams?: unknown; players?: unknown };
  const teams = Array.isArray(rec.teams) ? rec.teams : [];
  const players = playerNameMap(rec.players);
  const teamNames = teamNameMap(teams);
  const out: EspnTeamRosterSnapshot[] = [];
  for (const t of teams) {
    if (!t || typeof t !== "object") continue;
    const team = t as { id?: number; roster?: { entries?: unknown[] } };
    if (typeof team.id !== "number") continue;
    const buckets: EspnRosterBuckets = { starters: [], bench: [], reserve: [] };
    const entries = Array.isArray(team.roster?.entries) ? team.roster.entries : [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as { playerId?: number; lineupSlotId?: number };
      const playerId = typeof entry.playerId === "number" ? entry.playerId : null;
      const name = playerId != null ? players.get(playerId) ?? `player ${playerId}` : "player";
      buckets[slotBucket(typeof entry.lineupSlotId === "number" ? entry.lineupSlotId : null)].push(name);
    }
    out.push({
      teamId: team.id,
      teamName: teamNames.get(team.id) ?? `team ${team.id}`,
      buckets,
    });
  }
  return out;
}

function inferDraftStatus(data: unknown): EspnDraftStatusSnapshot {
  if (!data || typeof data !== "object") return { status: "unknown", reason: "missing payload" };
  const d = data as {
    draftDetail?: { drafted?: boolean; inProgress?: boolean; currentPick?: number; onTheClock?: number };
    status?: { currentMatchupPeriod?: number; firstScoringPeriod?: number; finalScoringPeriod?: number };
    teams?: unknown;
  };
  const teamNames = teamNameMap(d.teams);
  if (d.draftDetail?.inProgress === true) {
    return {
      status: "drafting",
      currentPick: d.draftDetail.currentPick ?? null,
      onTheClockTeam:
        typeof d.draftDetail.onTheClock === "number" ? teamNames.get(d.draftDetail.onTheClock) ?? null : null,
      reason: "draftDetail.inProgress=true",
    };
  }
  if (d.draftDetail?.drafted === true) {
    return { status: "complete", reason: "draftDetail.drafted=true" };
  }
  const cmp = d.status?.currentMatchupPeriod;
  if (typeof cmp === "number" && cmp > 0) {
    return { status: "complete", reason: "currentMatchupPeriod indicates season started" };
  }
  if (typeof cmp === "number" && cmp === 0) {
    return { status: "pre_draft", reason: "currentMatchupPeriod=0 and no draftDetail inProgress" };
  }
  return { status: "unknown", reason: "no strong draft indicators present" };
}

function normalizeRecentActivity(raw: unknown): EspnRecentActivityEvent[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as { transactionDetail?: unknown; teams?: unknown; players?: unknown };
  const txs = Array.isArray(r.transactionDetail) ? r.transactionDetail : [];
  const teams = teamNameMap(r.teams);
  const players = playerNameMap(r.players);
  const out: EspnRecentActivityEvent[] = [];
  for (const tx of txs) {
    if (!tx || typeof tx !== "object") continue;
    const t = tx as {
      id?: number;
      type?: number;
      executionType?: string;
      proposedDate?: number;
      processDate?: number;
      items?: Array<{ playerId?: number; fromTeamId?: number; toTeamId?: number }>;
      teamId?: number;
      bidAmount?: number;
    };
    const type = parseEspnType(t.type);
    const ts = (typeof t.processDate === "number" ? t.processDate : t.proposedDate) ?? 0;
    const items = Array.isArray(t.items) ? t.items : [];
    const moveSummary = items
      .slice(0, 4)
      .map((it) => {
        const pid = typeof it.playerId === "number" ? it.playerId : null;
        const from = typeof it.fromTeamId === "number" ? teams.get(it.fromTeamId) ?? `team ${it.fromTeamId}` : null;
        const to = typeof it.toTeamId === "number" ? teams.get(it.toTeamId) ?? `team ${it.toTeamId}` : null;
        const name = pid != null ? players.get(pid) ?? `player ${pid}` : "player";
        if (from && to) return `${name}: ${from} -> ${to}`;
        if (to) return `${name} -> ${to}`;
        return name;
      })
      .join(" | ");
    const summaryBase =
      type === "trade"
        ? "Trade"
        : type === "waiver"
          ? "Waiver/FA"
          : type === "free_agent"
            ? "Free Agent"
            : `Activity (${t.executionType ?? "other"})`;
    const bid = typeof t.bidAmount === "number" && t.bidAmount > 0 ? ` bid ${t.bidAmount}` : "";
    out.push({
      eventId: typeof t.id === "number" ? String(t.id) : `espn-${ts}-${out.length}`,
      createdAtMs: ts,
      type,
      summary: `${summaryBase}${bid}${moveSummary ? ` · ${moveSummary}` : ""}`,
    });
  }
  return out.sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function fetchEspnLeagueSnapshot(input: {
  leagueId: string;
  season: string;
  espnS2?: string;
  swid?: string;
}): Promise<{
  league: EspnLeagueSnapshot | null;
  recent: EspnRecentActivityEvent[];
  rosters: EspnTeamRosterSnapshot[];
  draft: EspnDraftStatusSnapshot;
  sourceUrl: string;
}> {
  const views = ["mSettings", "mTeam", "mRoster", "mRecentActivity", "mDraftDetail", "mStatus", "kona_player_info"];
  const url = espnLeagueUrl(input.season, input.leagueId, views);
  const cookieParts = [
    input.espnS2 ? `espn_s2=${input.espnS2}` : "",
    input.swid ? `SWID=${input.swid}` : "",
  ].filter(Boolean);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(cookieParts.length ? { Cookie: cookieParts.join("; ") } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ESPN HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  const obj = (data ?? {}) as { settings?: { name?: string }; status?: { currentMatchupPeriod?: number; finalScoringPeriod?: number } };
  const league: EspnLeagueSnapshot = {
    leagueId: input.leagueId,
    season: input.season,
    name: obj?.settings?.name?.trim() || `ESPN league ${input.leagueId}`,
    status:
      typeof obj?.status?.currentMatchupPeriod === "number"
        ? "in_season"
        : "unknown",
  };
  return {
    league,
    recent: normalizeRecentActivity(data),
    rosters: normalizeTeamRosters(data),
    draft: inferDraftStatus(data),
    sourceUrl: url,
  };
}

export async function fetchEspnLeagueSnapshots(_userToken: string): Promise<EspnLeagueSnapshot[]> {
  if (!espnEnabled()) return [];
  return [];
}
