import { prisma } from "@fantasy/db";
import { requireSessionUser } from "@/lib/sessionUser";

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.sleeperMentionMapping.findMany({
    where: { userId: user.id },
    orderBy: [{ guildId: "asc" }, { sleeperUserId: "asc" }],
  });
  return Response.json({ mappings: rows });
}

export async function PUT(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as
    | { guildId?: string; sleeperUserId?: string; discordUserId?: string; note?: string }
    | null;
  if (!body?.guildId || !body.sleeperUserId || !body.discordUserId) {
    return Response.json({ error: "guildId, sleeperUserId, discordUserId required" }, { status: 400 });
  }
  const row = await prisma.sleeperMentionMapping.upsert({
    where: { guildId_sleeperUserId: { guildId: body.guildId, sleeperUserId: body.sleeperUserId } },
    create: {
      userId: user.id,
      guildId: body.guildId,
      sleeperUserId: body.sleeperUserId,
      discordUserId: body.discordUserId,
      note: body.note ?? null,
    },
    update: { discordUserId: body.discordUserId, note: body.note ?? null, userId: user.id },
  });
  return Response.json({ mapping: row });
}

export async function DELETE(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const guildId = u.searchParams.get("guildId");
  const sleeperUserId = u.searchParams.get("sleeperUserId");
  if (!guildId || !sleeperUserId) return Response.json({ error: "guildId and sleeperUserId required" }, { status: 400 });
  await prisma.sleeperMentionMapping.deleteMany({ where: { userId: user.id, guildId, sleeperUserId } });
  return Response.json({ ok: true });
}
