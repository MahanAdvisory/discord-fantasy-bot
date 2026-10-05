-- Weekly Sleeper projections, keyed by player + season + week.

CREATE TABLE "sleeper_player_projections" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "season_type" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "pts_ppr" DOUBLE PRECISION,
    "pts_half_ppr" DOUBLE PRECISION,
    "pts_std" DOUBLE PRECISION,
    "stats" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sleeper_player_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sleeper_player_projections_player_id_season_season_type_week_key"
    ON "sleeper_player_projections"("player_id", "season", "season_type", "week");

CREATE INDEX "sleeper_player_projections_player_id_idx" ON "sleeper_player_projections"("player_id");

CREATE INDEX "sleeper_player_projections_season_week_idx" ON "sleeper_player_projections"("season", "week");
