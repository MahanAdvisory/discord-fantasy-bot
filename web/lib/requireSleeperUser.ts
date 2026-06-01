import { requireSessionUser } from "@/lib/sessionUser";

export async function requireSleeperUser() {
  const { user } = await requireSessionUser();
  if (!user) return { user: null, error: "unauthorized" as const };
  if (!user.sleeperUserId) return { user: null, error: "no_sleeper" as const };
  return { user, error: null };
}
