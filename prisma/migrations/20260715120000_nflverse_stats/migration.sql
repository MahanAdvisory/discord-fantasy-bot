-- CreateTable
CREATE TABLE "player_id_crosswalk" (
    "sleeper_player_id" TEXT NOT NULL,
    "gsis_id" TEXT,
    "espn_id" TEXT,
    "pfr_id" TEXT,
    "full_name" TEXT,
    "position" TEXT,
    "team" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_id_crosswalk_pkey" PRIMARY KEY ("sleeper_player_id")
);

-- CreateTable
CREATE TABLE "nfl_player_week_stats" (
    "id" TEXT NOT NULL,
    "player_key" TEXT NOT NULL,
    "gsis_id" TEXT,
    "sleeper_player_id" TEXT,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "season_type" TEXT NOT NULL DEFAULT 'REG',
    "grain" TEXT NOT NULL DEFAULT 'week',
    "player_name" TEXT,
    "position" TEXT,
    "team" TEXT,
    "opponent" TEXT,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER,
    "attempts" INTEGER,
    "passing_yards" INTEGER,
    "passing_tds" INTEGER,
    "interceptions" INTEGER,
    "passing_air_yards" INTEGER,
    "passing_yac" INTEGER,
    "carries" INTEGER,
    "rushing_yards" INTEGER,
    "rushing_tds" INTEGER,
    "rushing_fumbles_lost" INTEGER,
    "rushing_epa" DOUBLE PRECISION,
    "targets" INTEGER,
    "receptions" INTEGER,
    "receiving_yards" INTEGER,
    "receiving_tds" INTEGER,
    "receiving_air_yards" INTEGER,
    "receiving_yac" INTEGER,
    "receiving_fumbles_lost" INTEGER,
    "target_share" DOUBLE PRECISION,
    "air_yards_share" DOUBLE PRECISION,
    "wopr" DOUBLE PRECISION,
    "racr" DOUBLE PRECISION,
    "fantasy_points" DOUBLE PRECISION,
    "fantasy_points_ppr" DOUBLE PRECISION,
    "receptions_exp" DOUBLE PRECISION,
    "receiving_yards_exp" DOUBLE PRECISION,
    "receiving_tds_exp" DOUBLE PRECISION,
    "rushing_yards_exp" DOUBLE PRECISION,
    "rushing_tds_exp" DOUBLE PRECISION,
    "passing_yards_exp" DOUBLE PRECISION,
    "passing_tds_exp" DOUBLE PRECISION,
    "total_fantasy_points_exp" DOUBLE PRECISION,
    "total_fantasy_points_diff" DOUBLE PRECISION,
    "offense_snaps" INTEGER,
    "offense_snap_pct" DOUBLE PRECISION,
    "routes_run" INTEGER,
    "targets_per_route" DOUBLE PRECISION,
    "fantasypros_roster_pct" DOUBLE PRECISION,
    "raw" JSONB,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nfl_player_week_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleeper_player_week_starts" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "sleeper_player_id" TEXT NOT NULL,
    "roster_id" INTEGER NOT NULL,
    "was_started" BOOLEAN NOT NULL,
    "was_rostered" BOOLEAN NOT NULL DEFAULT true,
    "position" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleeper_player_week_starts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_id_crosswalk_gsis_id_key" ON "player_id_crosswalk"("gsis_id");

-- CreateIndex
CREATE INDEX "player_id_crosswalk_gsis_id_idx" ON "player_id_crosswalk"("gsis_id");

-- CreateIndex
CREATE INDEX "player_id_crosswalk_espn_id_idx" ON "player_id_crosswalk"("espn_id");

-- CreateIndex
CREATE INDEX "nfl_player_week_stats_season_week_position_idx" ON "nfl_player_week_stats"("season", "week", "position");

-- CreateIndex
CREATE INDEX "nfl_player_week_stats_sleeper_player_id_idx" ON "nfl_player_week_stats"("sleeper_player_id");

-- CreateIndex
CREATE INDEX "nfl_player_week_stats_gsis_id_idx" ON "nfl_player_week_stats"("gsis_id");

-- CreateIndex
CREATE UNIQUE INDEX "nfl_player_week_stats_player_key_season_week_season_type_grain_key" ON "nfl_player_week_stats"("player_key", "season", "week", "season_type", "grain");

-- CreateIndex
CREATE INDEX "sleeper_player_week_starts_season_week_sleeper_player_id_idx" ON "sleeper_player_week_starts"("season", "week", "sleeper_player_id");

-- CreateIndex
CREATE INDEX "sleeper_player_week_starts_league_id_season_week_idx" ON "sleeper_player_week_starts"("league_id", "season", "week");

-- CreateIndex
CREATE UNIQUE INDEX "sleeper_player_week_starts_league_id_season_week_sleeper_player_id_key" ON "sleeper_player_week_starts"("league_id", "season", "week", "sleeper_player_id");
