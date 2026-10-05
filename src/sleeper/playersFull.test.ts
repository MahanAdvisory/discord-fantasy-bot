import assert from "node:assert/strict";
import test from "node:test";
import { nflTeamFromPlayerData } from "./playersFull.js";

test("nflTeamFromPlayerData reads team and ignores unsigned placeholders", () => {
  assert.equal(nflTeamFromPlayerData({ team: "ATL" }), "ATL");
  assert.equal(nflTeamFromPlayerData({ team: " IND " }), "IND");
  assert.equal(nflTeamFromPlayerData({ team: null, team_abbr: "SF" }), "SF");
  assert.equal(nflTeamFromPlayerData({ team: "", team_abbr: "LAC" }), "LAC");
  assert.equal(nflTeamFromPlayerData({ team: "FA" }), null);
  assert.equal(nflTeamFromPlayerData({ team: "" }), null);
  assert.equal(nflTeamFromPlayerData({ team: null }), null);
  assert.equal(nflTeamFromPlayerData(null), null);
});
