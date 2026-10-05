import test from "node:test";
import assert from "node:assert/strict";
import { isSleeperBestBallLeague } from "./client.js";

test("detects Sleeper best_ball flag", () => {
  assert.equal(isSleeperBestBallLeague({ settings: { best_ball: 1 } }), true);
  assert.equal(isSleeperBestBallLeague({ settings: { best_ball: true } }), true);
  assert.equal(isSleeperBestBallLeague({ settings: { best_ball: "1" } }), true);
  assert.equal(isSleeperBestBallLeague({ settings: { best_ball: 0 } }), false);
  assert.equal(isSleeperBestBallLeague({ settings: {} }), false);
  assert.equal(isSleeperBestBallLeague(null), false);
});
