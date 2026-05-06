import assert from "node:assert/strict";
import test from "node:test";
import { buildWaiverBatchPages } from "./runPoll.js";

test("buildWaiverBatchPages paginates at six lines", () => {
  const lines = Array.from({ length: 13 }, (_, i) => `**League X** — Waiver/FA · tx-${i + 1}`);
  const pages = buildWaiverBatchPages("League X", lines, 6);
  assert.equal(pages.length, 3);
  assert.match(pages[0], /page 1\/3/);
  assert.match(pages[1], /page 2\/3/);
  assert.match(pages[2], /page 3\/3/);
});

test("buildWaiverBatchPages strips repeated league prefix in body lines", () => {
  const pages = buildWaiverBatchPages("My League", [
    "**My League** — Waiver/FA · tx-1",
    "**My League** — Waiver/FA · tx-2",
  ]);
  assert.equal(pages.length, 1);
  assert.ok(!pages[0].includes("**My League** — Waiver/FA · tx-1\n**My League**"));
  assert.match(pages[0], /Waiver\/FA · tx-1/);
  assert.match(pages[0], /Waiver\/FA · tx-2/);
});
