import assert from "node:assert/strict";
import test from "node:test";
import { journalKeys } from "./eventJournal.js";

test("journalKeys.transaction is stable and unique per league + tx", () => {
  assert.equal(journalKeys.transaction("L1", "T1"), "sleeper:v1:tx:L1:T1");
  assert.notEqual(journalKeys.transaction("L1", "T1"), journalKeys.transaction("L1", "T2"));
});

test("journalKeys.draftPick encodes draft and pick number", () => {
  assert.equal(journalKeys.draftPick("D1", 3), "sleeper:v1:draft:pick:D1:3");
});

test("journalKeys.draftOnClock encodes sequence pick", () => {
  assert.equal(journalKeys.draftOnClock("D1", 12), "sleeper:v1:draft:clock:D1:12");
});

test("journalKeys.draftAuctionNomination encodes draft and player", () => {
  assert.equal(journalKeys.draftAuctionNomination("D1", "P1"), "sleeper:v1:draft:auction:nom:D1:P1");
});

test("journalKeys.draftAuctionTimer encodes timer end", () => {
  assert.equal(
    journalKeys.draftAuctionTimer("D1", "P1", "2026-06-13T03:10:41Z"),
    "sleeper:v1:draft:auction:timer:D1:P1:2026-06-13T03:10:41Z",
  );
});
