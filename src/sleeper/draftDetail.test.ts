import test from "node:test";
import assert from "node:assert/strict";
import type { SleeperDraftDetail } from "./draftDetail.js";
import { getSnakeDraftPickerUserId } from "./draftDetail.js";

function mkDraft(overrides?: Partial<SleeperDraftDetail>): SleeperDraftDetail {
  return {
    draft_id: "d1",
    league_id: "l1",
    status: "drafting",
    type: "snake",
    settings: { teams: 4, rounds: 6 },
    draft_order: { u1: 1, u2: 2, u3: 3, u4: 4 },
    ...overrides,
  };
}

test("snake order alternates each round", () => {
  const d = mkDraft();
  assert.equal(getSnakeDraftPickerUserId(d, 0), "u1");
  assert.equal(getSnakeDraftPickerUserId(d, 3), "u4");
  assert.equal(getSnakeDraftPickerUserId(d, 4), "u4");
  assert.equal(getSnakeDraftPickerUserId(d, 7), "u1");
  assert.equal(getSnakeDraftPickerUserId(d, 8), "u1");
});

test("3RR keeps round three in round two order", () => {
  const d = mkDraft({ settings: { teams: 4, rounds: 6, reversal_round: 3 } });
  // Round 1
  assert.equal(getSnakeDraftPickerUserId(d, 0), "u1");
  assert.equal(getSnakeDraftPickerUserId(d, 3), "u4");
  // Round 2
  assert.equal(getSnakeDraftPickerUserId(d, 4), "u4");
  assert.equal(getSnakeDraftPickerUserId(d, 7), "u1");
  // Round 3 (same as round 2 for 3RR)
  assert.equal(getSnakeDraftPickerUserId(d, 8), "u4");
  assert.equal(getSnakeDraftPickerUserId(d, 11), "u1");
  // Round 4 resumes alternating
  assert.equal(getSnakeDraftPickerUserId(d, 12), "u1");
  assert.equal(getSnakeDraftPickerUserId(d, 15), "u4");
});
