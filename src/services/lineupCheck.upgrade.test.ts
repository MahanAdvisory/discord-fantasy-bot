import test from "node:test";
import assert from "node:assert/strict";
import { findProjectionUpgrades, PROJECTION_UPGRADE_MIN_DELTA } from "./lineupCheck.js";

function teams(...ids: string[]): Map<string, string | null> {
  return new Map(ids.map((id) => [id, "DET"]));
}

test("WR bench outscores WR starter", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["sit"],
    rosterPositions: ["WR"],
    bench: ["start"],
    projections: new Map([
      ["sit", 8],
      ["start", 14],
    ]),
    positions: new Map([
      ["sit", "WR"],
      ["start", "WR"],
    ]),
    teams: teams("sit", "start"),
    minDelta: 0.5,
  });
  assert.equal(upgrades.length, 1);
  assert.equal(upgrades[0].slot, "WR");
  assert.equal(upgrades[0].starterId, "sit");
  assert.equal(upgrades[0].benchId, "start");
});

test("WR bench can replace a lower FLEX starter", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["wr1", "flex"],
    rosterPositions: ["WR", "FLEX"],
    bench: ["benchWr"],
    projections: new Map([
      ["wr1", 16],
      ["flex", 9],
      ["benchWr", 13],
    ]),
    positions: new Map([
      ["wr1", "WR"],
      ["flex", "RB"],
      ["benchWr", "WR"],
    ]),
    teams: teams("wr1", "flex", "benchWr"),
  });
  assert.equal(upgrades.length, 1);
  assert.equal(upgrades[0].slot, "FLEX");
  assert.equal(upgrades[0].benchId, "benchWr");
});

test("QB bench cannot fill FLEX", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["flex"],
    rosterPositions: ["FLEX"],
    bench: ["qb"],
    projections: new Map([
      ["flex", 8],
      ["qb", 22],
    ]),
    positions: new Map([
      ["flex", "WR"],
      ["qb", "QB"],
    ]),
    teams: teams("flex", "qb"),
  });
  assert.equal(upgrades.length, 0);
});

test("assigns one bench player to the largest eligible delta", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["wr", "flex"],
    rosterPositions: ["WR", "FLEX"],
    bench: ["benchWr"],
    projections: new Map([
      ["wr", 10],
      ["flex", 8],
      ["benchWr", 15],
    ]),
    positions: new Map([
      ["wr", "WR"],
      ["flex", "WR"],
      ["benchWr", "WR"],
    ]),
    teams: teams("wr", "flex", "benchWr"),
  });
  assert.equal(upgrades.length, 1);
  assert.equal(upgrades[0].slot, "FLEX");
});

test("skips bench players with no NFL team", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["wr"],
    rosterPositions: ["WR"],
    bench: ["fa"],
    projections: new Map([
      ["wr", 5],
      ["fa", 20],
    ]),
    positions: new Map([
      ["wr", "WR"],
      ["fa", "WR"],
    ]),
    teams: new Map([
      ["wr", "KC"],
      ["fa", null],
    ]),
  });
  assert.equal(upgrades.length, 0);
});

test("does not flag deltas below the threshold", () => {
  const upgrades = findProjectionUpgrades({
    starters: ["wr"],
    rosterPositions: ["WR"],
    bench: ["benchWr"],
    projections: new Map([
      ["wr", 10],
      ["benchWr", 10 + PROJECTION_UPGRADE_MIN_DELTA - 0.01],
    ]),
    positions: new Map([
      ["wr", "WR"],
      ["benchWr", "WR"],
    ]),
    teams: teams("wr", "benchWr"),
  });
  assert.equal(upgrades.length, 0);
});
