import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { STATS_WEEK_ROLLUP } from "../sleeper/constants.js";
import { fetchAllNflPlayers } from "../sleeper/playersFull.js";
import {
  fetchPlayerStats,
  fetchStatsBulkForWeek,
} from "../sleeper/statsApi.js";
import {
  fetchWeeklyProjections,
  projectionPlayerId,
  projectionScoringFromRow,
  projectionStatsPayload,
} from "../sleeper/projections.js";

export const META_PLAYERS_SYNCED_AT = "players_catalog_synced_at";
export const META_PROJECTIONS_SYNCED = "projections_week_synced";

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

export type ProjectionsSyncMeta = {
  season: string;
  week: number;
  seasonType: string;
  at: string;
  count: number;
};

export function parseProjectionsSyncMeta(value: string | null | undefined): ProjectionsSyncMeta | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ProjectionsSyncMeta>;
    if (
      typeof parsed.season !== "string" ||
      typeof parsed.week !== "number" ||
      typeof parsed.seasonType !== "string" ||
      typeof parsed.at !== "string" ||
      typeof parsed.count !== "number"
    ) {
      return null;
    }
    return parsed as ProjectionsSyncMeta;
  } catch {
    return null;
  }
}

/** Fetch Sleeper weekly projections and upsert per-player rows + a bulk snapshot. */
export async function syncWeeklyProjections(
  client: PrismaClient,
  season: string | number,
  week: number,
  seasonType: "regular" | "post" | "pre" | "off" = "regular",
): Promise<{ count: number }> {
  const seasonStr = String(season);
  const rows = await fetchWeeklyProjections(seasonStr, week, seasonType);
  await client.sleeperStatsSnapshot.upsert({
    where: {
      kind_season_seasonType_week: {
        kind: "projections_bulk_week",
        season: seasonStr,
        seasonType,
        week,
      },
    },
    create: {
      kind: "projections_bulk_week",
      season: seasonStr,
      seasonType,
      week,
      payload: rows as Prisma.InputJsonValue,
    },
    update: {
      payload: rows as Prisma.InputJsonValue,
    },
  });

  const batchSize = 150;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const ops = [];
    for (const raw of slice) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const playerId = projectionPlayerId(row);
      if (!playerId) continue;
      const scoring = projectionScoringFromRow(row);
      const stats = projectionStatsPayload(row);
      ops.push(
        client.sleeperPlayerProjection.upsert({
          where: {
            playerId_season_seasonType_week: {
              playerId,
              season: seasonStr,
              seasonType,
              week,
            },
          },
          create: {
            playerId,
            season: seasonStr,
            seasonType,
            week,
            ptsPpr: scoring.ptsPpr,
            ptsHalfPpr: scoring.ptsHalfPpr,
            ptsStd: scoring.ptsStd,
            stats: stats as Prisma.InputJsonValue,
          },
          update: {
            ptsPpr: scoring.ptsPpr,
            ptsHalfPpr: scoring.ptsHalfPpr,
            ptsStd: scoring.ptsStd,
            stats: stats as Prisma.InputJsonValue,
          },
        }),
      );
    }
    if (ops.length) {
      await client.$transaction(ops);
      count += ops.length;
    }
  }

  const meta: ProjectionsSyncMeta = {
    season: seasonStr,
    week,
    seasonType,
    at: new Date().toISOString(),
    count,
  };
  await client.appMeta.upsert({
    where: { key: META_PROJECTIONS_SYNCED },
    create: { key: META_PROJECTIONS_SYNCED, value: JSON.stringify(meta) },
    update: { value: JSON.stringify(meta) },
  });
  return { count };
}
