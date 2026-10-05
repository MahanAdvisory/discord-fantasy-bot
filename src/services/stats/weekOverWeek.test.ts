import assert from "node:assert/strict";
import test from "node:test";
import { passingAverageTargetDistance } from "./leaderboardQuery.js";
import { rankWeekChanges } from "./weekOverWeek.js";

test("passing average target distance is air yards per attempt", () => {
  assert.equal(passingAverageTargetDistance(246, 30), 8.2);
  assert.equal(passingAverageTargetDistance(0, 10), 0);
  assert.equal(passingAverageTargetDistance(100, 0), null);
  assert.equal(passingAverageTargetDistance(null, 20), null);
  assert.equal(passingAverageTargetDistance(80, null), null);
});

test("week-over-week gains keep the largest increases that clear volume", () => {
  const ranked = rankWeekChanges(
    [
      sample("a", "Allen", 10, 22, 30, 35),
      sample("b", "Burrow", 18, 19, 40, 28),
      sample("c", "Cousins", 5, 40, 4, 30),
      sample("d", "Darnold", 12, null, 25, 25),
      sample("e", "Evans", 8, 3, 20, 22),
    ],
    { direction: "gain", minVolume: 10, limit: 5 },
  );
  assert.deepEqual(
    ranked.map((row) => row.playerKey),
    ["a", "b"],
  );
  assert.equal(ranked[0]?.delta, 12);
});

test("week-over-week drops sort the largest decreases first", () => {
  const ranked = rankWeekChanges(
    [
      sample("a", "Allen", 20, 11, 1, 1),
      sample("b", "Burrow", 30, 4, 1, 1),
      sample("c", "Cousins", 8, 9, 1, 1),
    ],
    { direction: "drop", minVolume: 0, limit: 1 },
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.playerKey, "b");
  assert.equal(ranked[0]?.delta, -26);
});

function sample(
  playerKey: string,
  playerName: string,
  startValue: number | null,
  endValue: number | null,
  startVolume: number,
  endVolume: number,
) {
  return {
    playerKey,
    playerName,
    team: "BUF",
    position: "QB",
    startValue,
    endValue,
    startVolume,
    endVolume,
  };
}
