import assert from "node:assert/strict";
import test from "node:test";
import { targetShareFromWeeklyTargets } from "./leaderboardQuery.js";

test("season target share uses team targets only in games the player played", () => {
  // Team has 40 targets in W1 and 40 in W2. Player A plays both weeks (10+10).
  // Player B only plays W1 (20 targets). Full-season team targets = 80.
  // A games-played share = 20/80 = 25%. B = 20/40 = 50% (not 20/80).
  const shares = targetShareFromWeeklyTargets([
    { playerKey: "A", team: "KC", week: 1, targets: 10 },
    { playerKey: "B", team: "KC", week: 1, targets: 20 },
    { playerKey: "C", team: "KC", week: 1, targets: 10 },
    { playerKey: "A", team: "KC", week: 2, targets: 10 },
    { playerKey: "C", team: "KC", week: 2, targets: 30 },
  ]);
  assert.equal(shares.get("A"), 0.25);
  assert.equal(shares.get("B"), 0.5);
  assert.equal(shares.get("C"), 0.5);
});
