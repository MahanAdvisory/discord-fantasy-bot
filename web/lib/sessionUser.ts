import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@fantasy/db";

export async function requireSessionUser() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user && "discordId" in session.user ? session.user.discordId : undefined;
  const email = session?.user?.email?.trim().toLowerCase();
  if (!discordId && !email) return { session, user: null };

  const user = discordId
    ? await prisma.user.findUnique({ where: { discordUserId: discordId } })
    : await prisma.user.findUnique({ where: { email } });
  return { session, user };
}
