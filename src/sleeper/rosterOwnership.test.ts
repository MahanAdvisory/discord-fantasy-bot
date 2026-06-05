import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SleeperRoster } from "./client.js";
import {
  findRosterForUser,
  rosterMemberIds,
  rosterOwnedBy,
  userIsAmongOnClockMembers,
} from "./rosterOwnership.js";

function roster(partial: Partial<SleeperRoster> & { roster_id: number }): SleeperRoster {
  return {
    owner_id: null,
    players: null,
    starters: null,
    ...partial,
  };
}

describe("rosterOwnership", () => {
  it("treats co_owners as full roster members", () => {
    const r = roster({ roster_id: 1, owner_id: "owner-a", co_owners: ["co-b", "co-c"] });
    assert.deepEqual(rosterMemberIds(r), ["owner-a", "co-b", "co-c"]);
    assert.equal(rosterOwnedBy(r, "owner-a"), true);
    assert.equal(rosterOwnedBy(r, "co-b"), true);
    assert.equal(rosterOwnedBy(r, "other"), false);
  });

  it("findRosterForUser matches co-owner", () => {
    const rosters = [roster({ roster_id: 2, owner_id: "primary", co_owners: ["partner"] })];
    assert.equal(findRosterForUser(rosters, "partner")?.roster_id, 2);
    assert.equal(findRosterForUser(rosters, "primary")?.roster_id, 2);
    assert.equal(findRosterForUser(rosters, "stranger"), undefined);
  });

  it("userIsAmongOnClockMembers includes co-owner ids", () => {
    assert.equal(userIsAmongOnClockMembers(["primary", "co-owner"], "co-owner"), true);
    assert.equal(userIsAmongOnClockMembers(["primary"], "co-owner"), false);
  });
});
