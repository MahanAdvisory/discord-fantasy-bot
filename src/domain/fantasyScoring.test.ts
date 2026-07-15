import assert from "node:assert/strict";
import test from "node:test";
import { scoreBox, scoreExpected, parseScoringQuery } from "./fantasyScoring.js";

test("PPR receiving score matches classic formula", () => {
  const pts = scoreBox(
    {
      position: "RB",
      rushingYards: 100,
      rushingTds: 1,
      receptions: 5,
      receivingYards: 40,
      receivingTds: 0,
    },
    { ...{ receptions: "ppr", passTd: 4, tePremium: 0, passYard: 0.04, rushYard: 0.1, recYard: 0.1, rushTd: 6, recTd: 6, interception: -2, fumbleLost: -2 } },
  );
  // 10 rush + 6 TD + 5 rec + 4 rec yards = 25
  assert.equal(pts, 25);
});

test("half-PPR and TE premium adjust reception value", () => {
  const base = scoreBox({ position: "TE", receptions: 4, receivingYards: 40 }, {
    receptions: "half_ppr",
    passTd: 4,
    tePremium: 0.5,
    passYard: 0.04,
    rushYard: 0.1,
    recYard: 0.1,
    rushTd: 6,
    recTd: 6,
    interception: -2,
    fumbleLost: -2,
  });
  // 4*(0.5+0.5) + 4 = 8
  assert.equal(base, 8);
});

test("6pt pass TD", () => {
  const pts = scoreBox({ position: "QB", passingYards: 300, passingTds: 2, interceptions: 1 }, {
    receptions: "ppr",
    passTd: 6,
    tePremium: 0,
    passYard: 0.04,
    rushYard: 0.1,
    recYard: 0.1,
    rushTd: 6,
    recTd: 6,
    interception: -2,
    fumbleLost: -2,
  });
  // 12 + 12 - 2 = 22
  assert.equal(pts, 22);
});

test("scoreExpected uses expected components", () => {
  const x = scoreExpected({ receptionsExp: 5, receivingYardsExp: 50, receivingTdsExp: 0.5 }, "WR", {
    receptions: "ppr",
    passTd: 4,
    tePremium: 0,
    passYard: 0.04,
    rushYard: 0.1,
    recYard: 0.1,
    rushTd: 6,
    recTd: 6,
    interception: -2,
    fumbleLost: -2,
  });
  assert.equal(x, 5 + 5 + 3);
});

test("parseScoringQuery", () => {
  const p = parseScoringQuery(new URLSearchParams("scoring=half_ppr&passTd=6&tePremium=1"));
  assert.equal(p.receptions, "half_ppr");
  assert.equal(p.passTd, 6);
  assert.equal(p.tePremium, 0.5);
});
