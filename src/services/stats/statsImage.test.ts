import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SCORING } from "../../domain/fantasyScoring.js";
import { LEADER_METRICS } from "./discordReports.js";
import type { StatsPlayerRow } from "./leaderboardQuery.js";
import { chartYRange, leadersScatterConfig, receivingScatterConfig, renderPlayerWeeklyImage } from "./statsImage.js";

test("receiving scatter metrics use the specified volume axes", () => {
  for (const metric of ["tgt_pct", "adot", "rec_epa"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, metric);
  }
  for (const metric of ["tprr", "yprr", "fd_rr"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "routes");
    assert.equal(config?.y.metric, metric);
  }
  const snapPct = leadersScatterConfig("snap_pct");
  assert.equal(snapPct?.x.metric, "snaps");
  assert.equal(snapPct?.y.metric, "snap_pct");
});

test("receiving volume metrics chart target share or YPRR", () => {
  for (const metric of ["tgt", "rec", "rec_yds", "air_yds", "rec_fd"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, "tgt_pct");
  }
  const routes = leadersScatterConfig("routes");
  assert.equal(routes?.x.metric, "routes");
  assert.equal(routes?.y.metric, "yprr");
});

test("rushing and passing metrics use carry and pass-attempt axes", () => {
  for (const metric of ["rush_epa", "fd_carry", "ypc"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "att");
    assert.equal(config?.y.metric, metric);
  }
  for (const metric of ["rush_yds", "rush_fd", "att"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "att");
    assert.equal(config?.y.metric, "ypc");
  }
  const passing = leadersScatterConfig("pass_yds");
  assert.equal(passing?.x.metric, "pass_att");
  assert.equal(passing?.y.metric, "ypa");
  const passAdot = leadersScatterConfig("pass_adot");
  assert.equal(passAdot?.x.metric, "pass_att");
  assert.equal(passAdot?.y.metric, "pass_adot");
});

test("legacy receiving config remains an alias", () => {
  assert.equal(receivingScatterConfig("rush_yds")?.y.metric, "ypc");
});

test("fantasy metrics retain the table image", () => {
  for (const metric of ["fpts", "vorp"]) {
    assert.equal(leadersScatterConfig(metric), null);
  }
});

test("percentage charts stay at or above zero", () => {
  const range = chartYRange("tgt_pct", 0.18, 0.31);
  assert.ok(range.yMin >= 0);
  assert.ok(range.yMax > range.yMin);
  assert.ok(range.yMax < 1);
  const floor = chartYRange("snap_pct", 0.01, 0.04);
  assert.equal(floor.yMin, 0);
});

test("discord leader metrics stay within slash-command choice limit", () => {
  assert.ok(LEADER_METRICS.length <= 25);
  assert.equal(LEADER_METRICS.filter((metric) => metric.value === "pass_adot").length, 1);
});

test("weekly player image renders a png with the trend chart", () => {
  const image = renderPlayerWeeklyImage({
    playerName: "Josh Allen",
    playerTeam: "BUF",
    playerPosition: "QB",
    season: 2025,
    scope: "passing",
    scoring: DEFAULT_SCORING,
    chartMetric: "pass_adot",
    weeks: [
      { week: 1, opponent: "NYJ", player: weekPlayer(18.2, 7.4) },
      { week: 2, opponent: "MIA", player: weekPlayer(24.6, 9.1) },
      { week: 4, opponent: "NE", player: weekPlayer(15.1, 6.2) },
    ],
  });
  assert.equal(image[0], 0x89);
  assert.equal(image[1], 0x50);
  assert.equal(image[2], 0x4e);
  assert.equal(image[3], 0x47);
  assert.ok(image.length > 1_000);
});

function weekPlayer(fpts: number, passingAdot: number): StatsPlayerRow {
  return {
    fpts,
    fptsPerGame: fpts,
    passingAdot,
    xfp: fpts - 1,
    fpoe: 1,
    box: {
      completions: 22,
      attempts: 32,
      passingYards: 260,
      passingTds: 2,
      interceptions: 1,
    },
  } as StatsPlayerRow;
}
