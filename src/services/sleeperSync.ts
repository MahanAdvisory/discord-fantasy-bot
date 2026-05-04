import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { STATS_WEEK_ROLLUP } from "../sleeper/constants.js";
import { fetchAllNflPlayers } from "../sleeper/playersFull.js";
import {
  fetchPlayerStats,
  fetchStatsBulkForWeek,
} from "../sleeper/statsApi.js";

const META_PLAYERS_SYNCED_AT = "players_catalog_synced_at";

/** Upsert full NFL player catalog from Sleeper (large payload — run weekly at most). */
export async function syncNflPlayerCatalog(prisma: PrismaClient): Promise<{ count: number }> {
  const map = await fetchAllNflPlayers();
  const entries = Object.entries(map);
  const batchSize = 150;
  let count = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    await prisma.$transaction(
      slice.map(([playerId, data]) =>
        prisma.sleeperPlayer.upsert({
          where: { playerId },
          create: { playerId, data: data as Prisma.InputJsonValue },
          update: { data: data as Prisma.InputJsonValue },
        }),
      ),
    );
    count += slice.length;
  }
  await prisma.appMeta.upsert({
    where: { key: META_PLAYERS_SYNCED_AT },
    create: { key: META_PLAYERS_SYNCED_AT, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  return { count };
}

/** Store raw bulk week stats JSON for replay/analysis. */
export async function syncStatsSnapshotWeek(
  prisma: PrismaClient,
  season: string | number,
  week: number,
  seasonType: "regular" | "post" | "pre" | "off" = "regular",
): Promise<void> {
  const payload = await fetchStatsBulkForWeek(season, week, seasonType);
  await prisma.sleeperStatsSnapshot.upsert({
    where: {
      kind_season_seasonType_week: {
        kind: "stats_bulk_week",
        season: String(season),
        seasonType,
        week,
      },
    },
    create: {
      kind: "stats_bulk_week",
      season: String(season),
      seasonType,
      week,
      payload: payload as Prisma.InputJsonValue,
    },
    update: {
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

/** Fetch and store per-player stats for one season rollup (`grouping=season`). */
export async function syncPlayerStatsSeasonRow(
  prisma: PrismaClient,
  playerId: string,
  season: string | number,
  seasonType: "regular" | "post" | "pre" | "off" = "regular",
): Promise<void> {
  const stats = await fetchPlayerStats(playerId, season, seasonType, "season");
  await prisma.sleeperPlayerStats.upsert({
    where: {
      playerId_season_seasonType_grouping_week: {
        playerId,
        season: String(season),
        seasonType,
        grouping: "season",
        week: STATS_WEEK_ROLLUP,
      },
    },
    create: {
      playerId,
      season: String(season),
      seasonType,
      grouping: "season",
      week: STATS_WEEK_ROLLUP,
      stats: stats as Prisma.InputJsonValue,
    },
    update: {
      stats: stats as Prisma.InputJsonValue,
    },
  });
}

/** Fetch and store per-player weekly stats (`grouping=week` returns multi-week blob). */
export async function syncPlayerStatsWeekGroupingRow(
  prisma: PrismaClient,
  playerId: string,
  season: string | number,
  seasonType: "regular" | "post" | "pre" | "off" = "regular",
): Promise<void> {
  const stats = await fetchPlayerStats(playerId, season, seasonType, "week");
  await prisma.sleeperPlayerStats.upsert({
    where: {
      playerId_season_seasonType_grouping_week: {
        playerId,
        season: String(season),
        seasonType,
        grouping: "week",
        week: STATS_WEEK_ROLLUP,
      },
    },
    create: {
      playerId,
      season: String(season),
      seasonType,
      grouping: "week",
      week: STATS_WEEK_ROLLUP,
      stats: stats as Prisma.InputJsonValue,
    },
    update: {
      stats: stats as Prisma.InputJsonValue,
    },
  });
}
