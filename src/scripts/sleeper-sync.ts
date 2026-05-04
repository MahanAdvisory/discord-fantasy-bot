/**
 * CLI: sync Sleeper player catalog and optional stats snapshots into Postgres.
 *
 * Usage:
 *   npx tsx src/scripts/sleeper-sync.ts players
 *   npx tsx src/scripts/sleeper-sync.ts stats-week [season] [week]
 */
import "dotenv/config";
import { getNflState } from "../sleeper/client.js";
import { prisma } from "../db.js";
import {
  syncNflPlayerCatalog,
  syncStatsSnapshotWeek,
} from "../services/sleeperSync.js";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  if (cmd === "players") {
    const { count } = await syncNflPlayerCatalog(prisma);
    console.log(`Synced ${count} NFL player rows.`);
    return;
  }
  if (cmd === "stats-week") {
    const seasonArg = process.argv[3];
    const weekArg = process.argv[4];
    const state = await getNflState();
    const season = seasonArg ?? state.season;
    const week = weekArg !== undefined ? parseInt(weekArg, 10) : state.week ?? state.display_week ?? 1;
    if (!Number.isFinite(week)) {
      console.error("Invalid week");
      process.exit(1);
    }
    await syncStatsSnapshotWeek(prisma, season, week, "regular");
    console.log(`Stored stats_bulk_week snapshot for ${season} week ${week}.`);
    return;
  }
  console.log(`Commands:
  players              Fetch GET /v1/players/nfl and upsert sleeper_players (heavy).
  stats-week [yr] [wk] Store bulk stats JSON for season/week (default: NFL state).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
