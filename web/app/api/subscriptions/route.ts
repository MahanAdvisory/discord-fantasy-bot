import { prisma } from "@fantasy/db";
import { ALL_LEAGUES_SCOPE, NOTIFICATION_CATEGORIES } from "@fantasy/domain/notifications";
import { requireSessionUser } from "@/lib/sessionUser";

async function discordGet(path: string): Promise<unknown | null> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.notificationSubscription.findMany({
    where: { userId: user.id },
    orderBy: [{ isDm: "desc" }, { sleeperLeagueScope: "asc" }, { category: "asc" }],
    select: {
      id: true,
      isDm: true,
      guildId: true,
      channelId: true,
      provider: true,
      sleeperLeagueScope: true,
      category: true,
    },
  });

  const uniqueGuildIds = [...new Set(rows.map((r) => r.guildId).filter((x): x is string => Boolean(x)))];
  const uniqueChannelIds = [...new Set(rows.map((r) => r.channelId).filter((x): x is string => Boolean(x)))];
  const guildNames = new Map<string, string>();
  const channelNames = new Map<string, string>();
  await Promise.all(
    uniqueGuildIds.map(async (id) => {
      const data = (await discordGet(`/guilds/${id}`)) as { name?: string } | null;
      if (data?.name) guildNames.set(id, data.name);
    }),
  );
  await Promise.all(
    uniqueChannelIds.map(async (id) => {
      const data = (await discordGet(`/channels/${id}`)) as { name?: string } | null;
      if (data?.name) channelNames.set(id, data.name);
    }),
  );

  return Response.json({
    ownerUserId: user.id,
    categories: NOTIFICATION_CATEGORIES,
    routes: rows.map((r) => ({
      ...r,
      leagueScopeLabel:
        r.sleeperLeagueScope === ALL_LEAGUES_SCOPE
          ? "All linked leagues"
          : r.sleeperLeagueScope === `espn:${ALL_LEAGUES_SCOPE}`
            ? "All linked ESPN leagues"
            : r.sleeperLeagueScope.startsWith("espn:")
              ? `ESPN ${r.sleeperLeagueScope.slice("espn:".length)}`
              : r.sleeperLeagueScope,
      destinationLabel: r.isDm
        ? "DM"
        : `${guildNames.get(r.guildId ?? "") ?? `Guild ${r.guildId ?? "?"}`} / ${channelNames.get(r.channelId ?? "") ?? `#${r.channelId ?? "?"}`}`,
    })),
  });
}

export async function PATCH(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { id?: string; enabled?: boolean; category?: string; sleeperLeagueScope?: string; provider?: "sleeper" | "espn" }
    | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  if (body.id) {
    if (body.enabled === false) {
      await prisma.notificationSubscription.deleteMany({ where: { id: body.id, userId: user.id } });
    }
    return Response.json({ ok: true });
  }

  const category = body.category?.trim().toLowerCase();
  if (!category || !NOTIFICATION_CATEGORIES.includes(category as (typeof NOTIFICATION_CATEGORIES)[number])) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }
  const scope = body.sleeperLeagueScope?.trim() || ALL_LEAGUES_SCOPE;
  const provider = body.provider === "espn" ? "espn" : "sleeper";
  const scoped = provider === "espn" ? (scope === ALL_LEAGUES_SCOPE ? `espn:${ALL_LEAGUES_SCOPE}` : `espn:${scope}`) : scope;
  const routeNamespace = `u:${user.id}`;
  await prisma.notificationSubscription.upsert({
    where: {
      routeNamespace_sleeperLeagueScope_category: {
        routeNamespace,
        sleeperLeagueScope: scoped,
        category,
      },
    },
    create: {
      userId: user.id,
      isDm: true,
      routeNamespace,
      provider,
      sleeperLeagueScope: scoped,
      category,
    },
    update: {},
  });
  return Response.json({ ok: true });
}
