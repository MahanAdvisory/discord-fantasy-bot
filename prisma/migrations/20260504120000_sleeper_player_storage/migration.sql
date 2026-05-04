-- Sleeper player catalog + stats storage for future features.

CREATE TABLE "sleeper_players" (
    "player_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sleeper_players_pkey" PRIMARY KEY ("player_id")
);

CREATE TABLE "sleeper_player_stats" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "season_type" TEXT NOT NULL,
    "grouping" TEXT NOT NULL,
    "week" INTEGER NOT NULL DEFAULT -1,
    "stats" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleeper_player_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sleeper_player_stats_player_id_season_season_type_grouping_week_key"
    ON "sleeper_player_stats"("player_id", "season", "season_type", "grouping", "week");

CREATE INDEX "sleeper_player_stats_player_id_idx" ON "sleeper_player_stats"("player_id");
CREATE INDEX "sleeper_player_stats_season_idx" ON "sleeper_player_stats"("season");

CREATE TABLE "sleeper_stats_snapshots" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "season_type" TEXT NOT NULL,
    "week" INTEGER NOT NULL DEFAULT -1,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleeper_stats_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sleeper_stats_snapshots_kind_season_season_type_week_key"
    ON "sleeper_stats_snapshots"("kind", "season", "season_type", "week");

CREATE INDEX "sleeper_stats_snapshots_season_idx" ON "sleeper_stats_snapshots"("season");

CREATE TABLE "app_meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_meta_pkey" PRIMARY KEY ("key")
);
