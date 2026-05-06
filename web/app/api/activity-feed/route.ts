import { getNflState, getUserLeagues, getLeagueRosters } from "@fantasy/sleeper/client";
import { getLeagueTransactions } from "@fantasy/sleeper/transactionsApi";
import { getDraftPicks, getLeagueDrafts } from "@fantasy/sleeper/draftDetail";
import { getLeagueUsers } from "@fantasy/sleeper/leagueUsers";
import { formatTransactionLine } from "@fantasy/services/notifications/formatTransaction";
import { sleeperDraftUrlPlain, sleeperLeagueUrlPlain } from "@fantasy/domain/sleeperLinks";
import { requireSessionUser } from "@/lib/sessionUser";

type ActivityFeedItem = {
  id: string;
  leagueId: string;
  leagueName: string;
  createdAtMs: number;
  kind: "transaction" | "draft_pick";
  text: string;
  url: string;
};

function playerSummary(p: { player_id: string; metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } }): string {
  const name =
    p.metadata?.last_name != null ? `${p.metadata?.first_name ?? ""} ${p.metadata.last_name}`.trim() : p.player_id;
  const pos = p.metadata?.position ?? "?";
  const team = p.metadata?.team?.trim();
  return team ? `${name} (${pos}, ${team})` : `${name} (${pos})`;
}

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!user?.sleeperUserId) {
    return Response.json(
      {
        error: "no_sleeper",
        message:
          "Link your Sleeper account with /link in Discord first (same Discord login). Then refresh this page.",
      },
      { status: 400 },
    );
  }

  const u = new URL(req.url);
  const selectedLeagueIds = (u.searchParams.get("leagues") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const offset = Math.max(0, Number.parseInt(u.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, Number.parseInt(u.searchParams.get("limit") ?? "20", 10) || 20));
  const involvesMyTeam = u.searchParams.get("involvesMyTeam") === "1";

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const week = Math.max(1, nfl.leg ?? nfl.display_week ?? nfl.week ?? 1);

  const leagues = await getUserLeagues(user.sleeperUserId, season);
  const leagueMap = new Map(leagues.map((l) => [l.league_id, l]));
  const leagueIds = selectedLeagueIds.length
    ? selectedLeagueIds.filter((id) => leagueMap.has(id))
    : leagues.map((l) => l.league_id);

  const items: ActivityFeedItem[] = [];

  for (const leagueId of leagueIds) {
    const league = leagueMap.get(leagueId);
    const leagueName = league?.name ?? leagueId;

    const users = await getLeagueUsers(leagueId).catch(() => []);
    const rosters = await getLeagueRosters(leagueId).catch(() => []);
    const userLabels = new Map(
      users
        .filter((x) => x.user_id)
        .map((x) => [x.user_id!, x.username?.trim() || x.display_name?.trim() || x.user_id!] as const),
    );
    const rosterLabels = new Map<number, string>();
    const myRosterId = rosters.find((r) => r.owner_id === user.sleeperUserId)?.roster_id;
    for (const r of rosters) {
      if (typeof r.roster_id !== "number") continue;
      const label = r.owner_id ? userLabels.get(r.owner_id) : null;
      rosterLabels.set(r.roster_id, label ?? `roster ${r.roster_id}`);
    }

    const txs = await getLeagueTransactions(leagueId, week).catch(() => []);
    for (const tx of txs) {
      if (tx.status !== "complete") continue;
      if (involvesMyTeam) {
        const touchedByRoster = typeof myRosterId === "number" && (tx.roster_ids ?? []).includes(myRosterId);
        const touchedByAddDrop =
          typeof myRosterId === "number" &&
          [...Object.values(tx.adds ?? {}), ...Object.values(tx.drops ?? {})].some((rid) => rid === myRosterId);
        if (!touchedByRoster && !touchedByAddDrop) continue;
      }
      const createdAtMs = tx.status_updated ?? tx.created ?? 0;
      items.push({
        id: `tx:${leagueId}:${tx.transaction_id}`,
        leagueId,
        leagueName,
        createdAtMs,
        kind: "transaction",
        text: formatTransactionLine(tx, leagueName, undefined, rosterLabels),
        url: sleeperLeagueUrlPlain(leagueId),
      });
    }

    const drafts = await getLeagueDrafts(leagueId).catch(() => []);
    for (const d of drafts) {
      const picks = await getDraftPicks(d.draft_id).catch(() => []);
      const tail = picks.slice(-20);
      const now = Date.now();
      const maxPickNo = tail.length ? Math.max(...tail.map((p) => p.pick_no ?? 0)) : 0;
      for (const p of tail) {
        if (involvesMyTeam && p.picked_by !== user.sleeperUserId) continue;
        const picker = userLabels.get(p.picked_by) ?? p.picked_by;
        const text = `${leagueName} draft · Pick ${p.pick_no}: ${playerSummary(p)} by ${picker}`;
        items.push({
          id: `pick:${d.draft_id}:${p.pick_no}`,
          leagueId,
          leagueName,
          // Sleeper draft pick payload does not include a reliable timestamp; preserve relative recency by pick number.
          createdAtMs: now - Math.max(0, maxPickNo - (p.pick_no ?? 0)),
          kind: "draft_pick",
          text,
          url: sleeperDraftUrlPlain(d.draft_id),
        });
      }
    }
  }

  items.sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id));
  const page = items.slice(offset, offset + limit);

  return Response.json({
    offset,
    limit,
    total: items.length,
    hasMore: offset + limit < items.length,
    nextOffset: offset + limit,
    items: page,
  });
}
