import test from "node:test";
import assert from "node:assert/strict";
import {
  preferredProjectionPoints,
  projectionPlayerId,
  projectionScoringFromRow,
} from "./projections.js";

test("reads pts from nested stats object", () => {
  const scoring = projectionScoringFromRow({
    player_id: "10881",
    stats: { pts_ppr: 18.4, pts_half_ppr: 16.4, pts_std: 14.4 },
  });
  assert.equal(scoring.ptsPpr, 18.4);
  assert.equal(preferredProjectionPoints(scoring), 18.4);
});

test("coerces numeric player ids", () => {
  assert.equal(projectionPlayerId({ player_id: 10881 }), "10881");
});
