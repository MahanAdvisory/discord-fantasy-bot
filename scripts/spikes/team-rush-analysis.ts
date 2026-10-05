import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type PlayerRow = {
  playerKey: string;
  playerName: string | null;
  position: string | null;
  carries: number;
  receptions: number;
};

type TeamAnalysis = {
  team: string;
  totalNonQbCarries: number;
  top1Carries: number;
  top2Carries: number;
  top3Carries: number;
  remainderCarries: number;
  rbReceptions: number;
  rbRecPct: number;
  rbTop1Rec: number;
  rbTop2Rec: number;
  rbTop3Rec: number;
  rbRemainderRec: number;
};

function rankByCarries(players: PlayerRow[]): PlayerRow[] {
  return [...players].sort((a, b) => b.carries - a.carries || b.receptions - a.receptions);
}

function topN(values: number[], n: number): { top: number[]; remainder: number } {
  const top = values.slice(0, n);
  const remainder = values.slice(n).reduce((sum, v) => sum + v, 0);
  return { top, remainder };
}

function analyzeTeam(team: string, players: PlayerRow[]): TeamAnalysis {
  const nonQb = rankByCarries(players.filter((p) => p.position !== "QB" && p.carries > 0));
  const carrySplit = topN(
    nonQb.map((p) => p.carries),
    3,
  );

  const teamReceptions = players.reduce((sum, p) => sum + p.receptions, 0);
  const rbs = rankByCarries(players.filter((p) => p.position === "RB"));
  const rbReceptions = rbs.reduce((sum, p) => sum + p.receptions, 0);
  const recSplit = topN(
    rbs.map((p) => p.receptions),
    3,
  );

  return {
    team,
    totalNonQbCarries: nonQb.reduce((sum, p) => sum + p.carries, 0),
    top1Carries: carrySplit.top[0] ?? 0,
    top2Carries: carrySplit.top[1] ?? 0,
    top3Carries: carrySplit.top[2] ?? 0,
    remainderCarries: carrySplit.remainder,
    rbReceptions,
    rbRecPct: teamReceptions > 0 ? (100 * rbReceptions) / teamReceptions : 0,
    rbTop1Rec: recSplit.top[0] ?? 0,
    rbTop2Rec: recSplit.top[1] ?? 0,
    rbTop3Rec: recSplit.top[2] ?? 0,
    rbRemainderRec: recSplit.remainder,
  };
}

function formatTable(rows: TeamAnalysis[]): string {
  const headers = [
    "Team",
    "Non-QB Carries",
    "Top1",
    "Top2",
    "Top3",
    "Remainder",
    "RB Rec",
    "RB Rec%",
    "RB1 Rec",
    "RB2 Rec",
    "RB3 Rec",
    "RB Rem",
  ];
  const data = rows.map((r) => [
    r.team,
    String(r.totalNonQbCarries),
    String(r.top1Carries),
    String(r.top2Carries),
    String(r.top3Carries),
    String(r.remainderCarries),
    String(r.rbReceptions),
    r.rbRecPct.toFixed(1),
    String(r.rbTop1Rec),
    String(r.rbTop2Rec),
    String(r.rbTop3Rec),
    String(r.rbRemainderRec),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]!.length)),
  );
  const pad = (s: string, i: number) => s.padStart(widths[i]!);
  const line = (cells: string[]) => cells.map((c, i) => pad(c, i)).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...data.map((row) => line(row))].join("\n");
}

async function main() {
  const season = Number(process.argv[2] ?? 2025);
  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season,
      grain: "season",
      week: -1,
      seasonType: { in: ["REG", "reg", "REG+POST"] },
      team: { not: null },
    },
    select: {
      team: true,
      playerKey: true,
      playerName: true,
      position: true,
      carries: true,
      receptions: true,
    },
  });

  if (rows.length === 0) {
    const seasons = await prisma.nflPlayerWeekStat.groupBy({
      by: ["season"],
      where: { grain: "season", week: -1 },
      _count: true,
      orderBy: { season: "desc" },
    });
    console.error(`No season rows for ${season}. Available seasons:`, seasons);
    process.exit(1);
  }

  const byTeam = new Map<string, PlayerRow[]>();
  for (const row of rows) {
    const team = row.team!;
    const list = byTeam.get(team) ?? [];
    list.push({
      playerKey: row.playerKey,
      playerName: row.playerName,
      position: row.position,
      carries: row.carries ?? 0,
      receptions: row.receptions ?? 0,
    });
    byTeam.set(team, list);
  }

  const analysis = [...byTeam.entries()]
    .map(([team, players]) => analyzeTeam(team, players))
    .sort((a, b) => a.team.localeCompare(b.team));

  console.log(`Season ${season} (REG) — ${analysis.length} teams\n`);
  console.log(formatTable(analysis));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
