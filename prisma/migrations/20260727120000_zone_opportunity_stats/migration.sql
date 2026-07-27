-- Zone opportunity counts derived from nflverse play-by-play.
-- Red zone: yardline_100 <= 20. Green zone: yardline_100 <= 10.
ALTER TABLE "nfl_player_week_stats"
  ADD COLUMN "red_zone_carries" INTEGER,
  ADD COLUMN "red_zone_targets" INTEGER,
  ADD COLUMN "green_zone_carries" INTEGER,
  ADD COLUMN "green_zone_targets" INTEGER;
