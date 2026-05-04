import test from "node:test";
import assert from "node:assert/strict";
import { playerEligibleForRosterSlot } from "./lineupCheck.js";

test("FLEX allows RB/WR/TE only", () => {
  assert.equal(playerEligibleForRosterSlot("FLEX", "RB"), true);
  assert.equal(playerEligibleForRosterSlot("FLEX", "QB"), false);
});

test("SUPER_FLEX allows QB", () => {
  assert.equal(playerEligibleForRosterSlot("SUPER_FLEX", "QB"), true);
  assert.equal(playerEligibleForRosterSlot("SUPER_FLEX", "K"), false);
});

test("normalizes slot spacing and case", () => {
  assert.equal(playerEligibleForRosterSlot("super flex", "qb"), true);
});
