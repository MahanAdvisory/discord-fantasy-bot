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

/** Parallel to `buckets`: ESPN fantasy player ids in the same order (for Sleeper crosswalk). */
export interface EspnRosterPlayerIdBuckets {
  starters: number[];
  bench: number[];
  reserve: number[];
}

export interface EspnTeamRosterSnapshot {
  teamId: number;
  teamName: string;
  buckets: EspnRosterBuckets;
  playerIds: EspnRosterPlayerIdBuckets;
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

/** ESPN `proTeamId` → NFL abbreviation (from community lm-api constants). */
const ESPN_PRO_TEAM_ABBR: Record<number, string> = {
  0: "None",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

/** D/ST fantasy player ids are negative; commonly `-(16000 + proTeamId)`. */
function dstLabelFromNegativePlayerId(playerId: number): string | null {
  if (playerId >= 0) return null;
  const proTeamId = Math.abs(playerId) - 16000;
  const abbr = ESPN_PRO_TEAM_ABBR[proTeamId];
  if (abbr && abbr !== "None") return `${abbr} D/ST`;
  return null;
}

type EspnNestedPlayer = {
  id?: number;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  proTeamId?: number;
};

function nameFromNestedPlayer(pl: EspnNestedPlayer): string | null {
  const full = typeof pl.fullName === "string" ? pl.fullName.trim() : "";
  if (full) return full;
  const first = typeof pl.firstName === "string" ? pl.firstName : "";
  const last = typeof pl.lastName === "string" ? pl.lastName : "";
  const combo = `${first} ${last}`.trim();
  return combo || null;
}

function nestedPlayerFromEntry(entry: {
  playerPoolEntry?: { player?: EspnNestedPlayer };
}): EspnNestedPlayer | null {
  const pl = entry.playerPoolEntry?.player;
  return pl && typeof pl === "object" ? pl : null;
}

function ingestPlayerNode(p: unknown, out: Map<number, string>): void {
  if (!p || typeof p !== "object") return;
  const o = p as Record<string, unknown>;
  const inner =
    (o.playerPoolEntry && typeof o.playerPoolEntry === "object"
      ? (o.playerPoolEntry as { player?: unknown }).player
      : null) ??
    (o.player && typeof o.player === "object" ? o.player : null) ??
    o;
  if (!inner || typeof inner !== "object") return;
  const pl = inner as EspnNestedPlayer;
  const id = typeof pl.id === "number" ? pl.id : typeof o.id === "number" ? o.id : null;
  const nm = nameFromNestedPlayer(pl);
  if (id != null && nm) out.set(id, nm);
}

function playerNameMap(players: unknown): Map<number, string> {
  const out = new Map<number, string>();
  if (!Array.isArray(players)) return out;
  for (const p of players) {
    ingestPlayerNode(p, out);
  }
  return out;
}

function resolveRosterEntryLabel(
  entry: {
    playerId?: number;
    playerPoolEntry?: { player?: EspnNestedPlayer };
  },
  playersById: Map<number, string>,
): string {
  const pid = typeof entry.playerId === "number" ? entry.playerId : null;
  const nested = nestedPlayerFromEntry(entry);
  if (nested) {
    const nm = nameFromNestedPlayer(nested);
    if (nm) return nm;
    if (pid != null && pid < 0 && typeof nested.proTeamId === "number") {
      const abbr = ESPN_PRO_TEAM_ABBR[nested.proTeamId];
      if (abbr && abbr !== "None") return `${abbr} D/ST`;
    }
  }
  if (pid == null) return "player";
  if (pid < 0) return dstLabelFromNegativePlayerId(pid) ?? `D/ST (${pid})`;
  return playersById.get(pid) ?? `player ${pid}`;
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

function teamOverallRecord(team: unknown): { wins: number; losses: number; ties: number } | null {
  if (!team || typeof team !== "object") return null;
  const t = team as { record?: { overall?: { wins?: number; losses?: number; ties?: number } } };
  const o = t.record?.overall;
  if (!o || typeof o !== "object") return null;
  const wins = typeof o.wins === "number" ? o.wins : 0;
  const losses = typeof o.losses === "number" ? o.losses : 0;
  const ties = typeof o.ties === "number" ? o.ties : 0;
  return { wins, losses, ties };
}

function teamRecordIndex(raw: unknown): Map<number, { wins: number; losses: number; ties: number }> {
  const m = new Map<number, { wins: number; losses: number; ties: number }>();
  if (!raw || typeof raw !== "object") return m;
  const rec = raw as { teams?: unknown };
  const teams = Array.isArray(rec.teams) ? rec.teams : [];
  for (const t of teams) {
    if (!t || typeof t !== "object") continue;
    const id = (t as { id?: number }).id;
    if (typeof id !== "number") continue;
    const r = teamOverallRecord(t);
    if (r) m.set(id, r);
  }
  return m;
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
    const playerIds: EspnRosterPlayerIdBuckets = { starters: [], bench: [], reserve: [] };
    const entries = Array.isArray(team.roster?.entries) ? team.roster.entries : [];
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      const entry = e as { playerId?: number; lineupSlotId?: number; playerPoolEntry?: { player?: EspnNestedPlayer } };
      const slot = slotBucket(typeof entry.lineupSlotId === "number" ? entry.lineupSlotId : null);
      const pid = typeof entry.playerId === "number" ? entry.playerId : null;
      const name = resolveRosterEntryLabel(entry, players);
      buckets[slot].push(name);
      playerIds[slot].push(pid ?? -1);
    }
    out.push({
      teamId: team.id,
      teamName: teamNames.get(team.id) ?? `team ${team.id}`,
      buckets,
      playerIds,
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

/** ESPN uses 1 = Sunday … 7 = Saturday for `waiverProcessDays` (per common lm-api payloads). */
const ESPN_WAIVER_DAY: Record<number, string> = {
  1: "Sunday",
  2: "Monday",
  3: "Tuesday",
  4: "Wednesday",
  5: "Thursday",
  6: "Friday",
  7: "Saturday",
};

function currentEspnWaiverDayNumEt(): number {
  const wd = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const m: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
  return m[wd] ?? 1;
}

export interface EspnWaiverSchedule {
  /** Human-readable waiver run summary, or null if unknown. */
  label: string | null;
  /** Days until next listed waiver day (ET calendar), for sorting; null if unknown. */
  dayOffset: number | null;
}

/**
 * Best-effort waiver schedule from `mSettings` payload (`settings.acquisitionSettings`).
 */
export function parseEspnWaiverSchedule(data: unknown): EspnWaiverSchedule {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const settings = root.settings as Record<string, unknown> | undefined;
  const acq = settings?.acquisitionSettings as Record<string, unknown> | undefined;
  if (!acq) return { label: null, dayOffset: null };

  const acqType = typeof acq.acquisitionType === "string" ? acq.acquisitionType : "";

  if (acqType === "FREEAGENT") {
    return { label: "No waivers (free agency)", dayOffset: null };
  }

  const daysRaw = acq.waiverProcessDays;
  const days = Array.isArray(daysRaw)
    ? daysRaw.filter((x): x is number => typeof x === "number" && x >= 1 && x <= 7)
    : [];
  const hourRaw = acq.waiverProcessHour;

  if ((acqType.includes("CONTINUOUS") || acqType.includes("FAB")) && !days.length) {
    return { label: "Continuous / FAB waivers (see ESPN)", dayOffset: null };
  }

  if (!days.length) {
    return { label: null, dayOffset: null };
  }

  const uniqueDays = [...new Set(days)].sort((a, b) => a - b);
  const dayPart = uniqueDays.map((d) => ESPN_WAIVER_DOW[d] ?? `Day ${d}`).join(", ");
  const hourPart =
    typeof hourRaw === "number" && hourRaw >= 0 && hourRaw <= 23
      ? `${String(hourRaw).padStart(2, "0")}:00 ET`
      : null;
  const label = hourPart ? `${dayPart} · ${hourPart}` : dayPart;

  const cur = currentEspnWaiverDayNumEt();
  const offsets = uniqueDays.map((d) => (d - cur + 7) % 7);
  const dayOffset = Math.min(...offsets);

  return { label, dayOffset };
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
  teamRecordByTeamId: Map<number, { wins: number; losses: number; ties: number }>;
  waiverSchedule: EspnWaiverSchedule;
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
    teamRecordByTeamId: teamRecordIndex(data),
    waiverSchedule: parseEspnWaiverSchedule(data),
  };
}

export async function fetchEspnLeagueSnapshots(_userToken: string): Promise<EspnLeagueSnapshot[]> {
  if (!espnEnabled()) return [];
  return [];
}
