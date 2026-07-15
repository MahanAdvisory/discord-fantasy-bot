import assert from "node:assert/strict";
import test from "node:test";
import {
  pickReplacementPoints,
  pickReplacementLevel,
  replacementFloorIndex,
  vorpOverActiveGames,
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
  // Floor is index 35 (65 pts). Pool is 0.3–0.8 start rate and < floor → max among those.
  assert.ok(rep < 100 - 35);
  assert.ok(rep > 0);
});

test("VORP prorates replacement to active games only", () => {
  const ranked = Array.from({ length: 50 }, (_, i) => ({
    sleeperPlayerId: String(i),
    fpts: (100 - i) * 17,
    games: 17,
    startRate: i < 20 ? 0.9 : i < 40 ? 0.5 : 0.1,
  }));
  const rep = pickReplacementLevel(ranked, { startCount: 3, teams: 12 });
  // 16-game star shouldn't be charged a 17th week of replacement
  const g16 = vorpOverActiveGames(rep.fptsPerGame * 16 + 80, 16, rep);
  const g17 = vorpOverActiveGames(rep.fptsPerGame * 17 + 80, 17, rep);
  assert.equal(Math.round(g16 * 10) / 10, Math.round(g17 * 10) / 10);
  assert.equal(Math.round(g16), 80);
});
