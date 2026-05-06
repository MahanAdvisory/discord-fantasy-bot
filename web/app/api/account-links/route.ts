import { requireSessionUser } from "@/lib/sessionUser";
import { prisma } from "@fantasy/db";
import { getUserByUsername } from "@fantasy/sleeper/client";

type Body = {
  sleeperUsername?: string;
  espnLeagueIds?: string[];
  espnSeason?: string | null;
  espnS2?: string | null;
  espnSwid?: string | null;
};

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const espnLeagueIds = Array.isArray((user as { espnLeagueIds?: unknown }).espnLeagueIds)
    ? ((user as { espnLeagueIds?: unknown }).espnLeagueIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return Response.json({
    sleeperUsername: user.sleeperUsername,
    sleeperUserId: user.sleeperUserId,
    espnLeagueIds,
    espnSeason: (user as { espnSeason?: string | null }).espnSeason ?? null,
    hasEspnPrivateCookies: Boolean((user as { espnS2?: string | null }).espnS2 && (user as { espnSwid?: string | null }).espnSwid),
  });
}

export async function PATCH(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Body;

  let sleeperPatch: { sleeperUsername?: string | null; sleeperUserId?: string | null } = {};
  if (body.sleeperUsername?.trim()) {
    const su = await getUserByUsername(body.sleeperUsername.trim());
    if (!su) {
      return Response.json({ error: "Sleeper username not found" }, { status: 400 });
    }
    sleeperPatch = { sleeperUsername: su.username, sleeperUserId: su.user_id };
  }

  const espnLeagueIds = Array.isArray(body.espnLeagueIds)
    ? [...new Set(body.espnLeagueIds.map((x) => x.trim()).filter(Boolean))]
    : undefined;

  const updated = await (prisma.user as unknown as { update: (args: unknown) => Promise<unknown> }).update({
    where: { id: user.id },
    data: {
      ...sleeperPatch,
      ...(espnLeagueIds ? { espnLeagueIds } : {}),
      ...(body.espnSeason?.trim() ? { espnSeason: body.espnSeason.trim() } : {}),
      ...(body.espnS2 !== undefined ? { espnS2: body.espnS2?.trim() || null } : {}),
      ...(body.espnSwid !== undefined ? { espnSwid: body.espnSwid?.trim() || null } : {}),
    },
  });

  const updatedUser = updated as {
    sleeperUsername?: string | null;
    sleeperUserId?: string | null;
    espnLeagueIds?: unknown;
    espnSeason?: string | null;
    espnS2?: string | null;
    espnSwid?: string | null;
  };
  return Response.json({
    ok: true,
    sleeperUsername: updatedUser.sleeperUsername ?? null,
    sleeperUserId: updatedUser.sleeperUserId ?? null,
    espnLeagueIds: Array.isArray(updatedUser.espnLeagueIds) ? updatedUser.espnLeagueIds : [],
    espnSeason: updatedUser.espnSeason ?? null,
    hasEspnPrivateCookies: Boolean(updatedUser.espnS2 && updatedUser.espnSwid),
  });
}
