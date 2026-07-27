import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/sessionUser";
import { queryZoneOpportunityExploration } from "@fantasy/services/stats/zoneOpportunities";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const endSeason = Number(u.searchParams.get("season") ?? new Date().getFullYear());
  if (!Number.isFinite(endSeason) || endSeason < 2000 || endSeason > 2100) {
    return NextResponse.json({ error: "invalid season" }, { status: 400 });
  }
  const years = Number(u.searchParams.get("years") ?? "3");
  const position = (u.searchParams.get("position") ?? "RB").toUpperCase();
  const q = u.searchParams.get("q");
  const sort = u.searchParams.get("sort") ?? "peak_opps_g";
  const dir = (u.searchParams.get("dir") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const limit = Number(u.searchParams.get("limit") ?? "100");

  const result = await queryZoneOpportunityExploration({
    endSeason,
    years: Number.isFinite(years) ? years : 3,
    position,
    q,
    sort,
    dir,
    limit: Number.isFinite(limit) ? limit : 100,
  });

  return NextResponse.json({
    ...result,
    season: endSeason,
    position,
    sort,
    dir,
    q,
    attribution: "Data: nflverse play-by-play · red zone ≤20 · green zone ≤10",
  });
}
