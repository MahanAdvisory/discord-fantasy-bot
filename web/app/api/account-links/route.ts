import { requireSessionUser } from "@/lib/sessionUser";
import { prisma } from "@fantasy/db";
import { espnLeagueIdsFromJson, espnTeamByLeagueFromJson } from "@fantasy/espn/linkedLeagues";
import { getUserById, getUserByUsername } from "@fantasy/sleeper/client";
import type { Prisma } from "@prisma/client";

type Body = {
  sleeperUsername?: string;
  sleeperUserId?: string;
  espnLeagueIds?: string[];
  /** ESPN league id -> your team id in that league */
  espnTeamByLeague?: Record<string, unknown>;
  espnSeason?: string | null;
  espnS2?: string | null;
  espnSwid?: string | null;
};

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({
    sleeperUsername: user.sleeperUsername,
    sleeperUserId: user.sleeperUserId,
    espnLeagueIds: espnLeagueIdsFromJson(user.espnLeagueIds),
    espnTeamByLeague: espnTeamByLeagueFromJson(user.espnTeamByLeague),
    espnSeason: user.espnSeason ?? null,
    hasEspnPrivateCookies: Boolean(user.espnS2 && user.espnSwid),
  });
}

export async function PATCH(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Body;

  let sleeperPatch: { sleeperUsername?: string | null; sleeperUserId?: string | null } = {};
  const incomingSleeperId = typeof body.sleeperUserId === "string" ? body.sleeperUserId.trim() : "";
  const incomingSleeperUsername = typeof body.sleeperUsername === "string" ? body.sleeperUsername.trim() : "";

  if (incomingSleeperId) {
    if (incomingSleeperId !== user.sleeperUserId) {
      const su = await getUserById(incomingSleeperId);
      if (!su) {
        return Response.json({ error: "Sleeper user id not found" }, { status: 400 });
      }
      sleeperPatch = { sleeperUsername: su.username, sleeperUserId: su.user_id };
    }
  } else if (incomingSleeperUsername) {
    const sameUsername =
      user.sleeperUsername &&
      incomingSleeperUsername.toLowerCase() === user.sleeperUsername.toLowerCase();
    if (!sameUsername || !user.sleeperUserId) {
      const su = await getUserByUsername(incomingSleeperUsername);
      if (!su) {
        return Response.json({ error: "Sleeper username not found" }, { status: 400 });
      }
      sleeperPatch = { sleeperUsername: su.username, sleeperUserId: su.user_id };
    }
  }

  const espnLeagueIds = Array.isArray(body.espnLeagueIds)
    ? [...new Set(body.espnLeagueIds.map((x) => String(x).trim()).filter(Boolean))]
    : undefined;

  const data: Prisma.UserUpdateInput = { ...sleeperPatch };
  if (espnLeagueIds !== undefined) {
    data.espnLeagueIds = espnLeagueIds;
  }
  if (body.espnSeason?.trim()) {
    data.espnSeason = body.espnSeason.trim();
  }
  if (body.espnS2 !== undefined) {
    data.espnS2 = body.espnS2?.trim() || null;
  }
  if (body.espnSwid !== undefined) {
    data.espnSwid = body.espnSwid?.trim() || null;
  }
  if (body.espnTeamByLeague !== undefined && body.espnTeamByLeague !== null) {
    let tm = espnTeamByLeagueFromJson(body.espnTeamByLeague);
    if (espnLeagueIds !== undefined) {
      const allowed = new Set(espnLeagueIds);
      tm = Object.fromEntries(Object.entries(tm).filter(([k]) => allowed.has(k)));
    }
    data.espnTeamByLeague = tm;
  } else if (espnLeagueIds !== undefined) {
    const prev = espnTeamByLeagueFromJson(user.espnTeamByLeague);
    const allowed = new Set(espnLeagueIds);
    data.espnTeamByLeague = Object.fromEntries(Object.entries(prev).filter(([k]) => allowed.has(k)));
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data,
  });

  return Response.json({
    ok: true,
    sleeperUsername: updatedUser.sleeperUsername ?? null,
    sleeperUserId: updatedUser.sleeperUserId ?? null,
    espnLeagueIds: espnLeagueIdsFromJson(updatedUser.espnLeagueIds),
    espnTeamByLeague: espnTeamByLeagueFromJson(updatedUser.espnTeamByLeague),
    espnSeason: updatedUser.espnSeason ?? null,
    hasEspnPrivateCookies: Boolean(updatedUser.espnS2 && updatedUser.espnSwid),
  });
}
