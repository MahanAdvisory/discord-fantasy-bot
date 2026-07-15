import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWeeklyReplacementMap,
  pickReplacementPoints,
  replacementFloorIndex,
  vorpFromWeeklyScores,
} from "./vorp.js";

test("replacementFloorIndex for 3-WR 12-team is WR36 (0-based 35)", () => {
  assert.equal(replacementFloorIndex(3, 12), 35);
});

test("pickReplacementPoints prefers mid start-rate pool below cutoff", () => {
  const ranked = Array.from({ length: 50 }, (_, i) => ({
    sleeperPlayerId: String(i),
    fpts: 100 - i,
    startRate: i < 20 ? 0.9 : i < 40 ? 0.5 : 0.1,
  }));
  const rep = pickReplacementPoints(ranked, { startCount: 3, teams: 12 });
  assert.ok(rep < 100 - 35);
  assert.ok(rep > 0);
});

test("VORP sums only active weeks against that week's replacement", () => {
  const replacementByWeek = new Map([
    [1, 10],
    [2, 8], // bye-heavy week → lower replacement
    [3, 12],
  ]);
  // Player missed week 2 (inactive) — should not subtract week-2 replacement
  const vorp = vorpFromWeeklyScores(
    [
      { week: 1, fpts: 20 },
      { week: 3, fpts: 18 },
    ],
    replacementByWeek,
  );
  assert.equal(vorp, (20 - 10) + (18 - 12));
});

test("buildWeeklyReplacementMap uses each week's own leaderboard", () => {
  const weeks = new Map([
    [
      1,
      Array.from({ length: 40 }, (_, i) => ({
        sleeperPlayerId: String(i),
        fpts: 20 - i * 0.2,
        startRate: i < 10 ? 0.9 : 0.5,
      })),
    ],
    [
      2,
      Array.from({ length: 40 }, (_, i) => ({
        sleeperPlayerId: String(i),
        fpts: 8 - i * 0.1, // depressed bye week
        startRate: i < 10 ? 0.9 : 0.5,
      })),
    ],
  ]);
  const map = buildWeeklyReplacementMap(weeks, { startCount: 3 });
  assert.ok((map.get(1) ?? 0) > (map.get(2) ?? 0));
});
