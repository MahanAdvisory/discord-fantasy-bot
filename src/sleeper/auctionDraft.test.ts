import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAuctionAmount,
  isAuctionDraft,
  isAuctionTimerExpiringSoon,
  parseAuctionMetadata,
  parseTimerEndAt,
} from "./auctionDraft.js";

test("isAuctionDraft detects auction type", () => {
  assert.equal(isAuctionDraft({ type: "auction" }), true);
  assert.equal(isAuctionDraft({ type: "snake" }), false);
  assert.equal(isAuctionDraft({}), false);
});

test("parseAuctionMetadata extracts auction fields", () => {
  const meta = parseAuctionMetadata({
    name: "League",
    nominated_player_id: "12507",
    highest_offer: "165",
    timer_end_at: "2026-06-13T03:10:41.094313Z",
  });
  assert.equal(meta.nominated_player_id, "12507");
  assert.equal(meta.highest_offer, "165");
  assert.equal(meta.timer_end_at, "2026-06-13T03:10:41.094313Z");
});

test("isAuctionTimerExpiringSoon within window", () => {
  const now = new Date("2026-06-13T03:00:00.000Z");
  assert.equal(
    isAuctionTimerExpiringSoon("2026-06-13T03:09:00.000Z", 10, now),
    true,
  );
  assert.equal(
    isAuctionTimerExpiringSoon("2026-06-13T03:11:00.000Z", 10, now),
    false,
  );
  assert.equal(
    isAuctionTimerExpiringSoon("2026-06-13T02:59:00.000Z", 10, now),
    false,
  );
});

test("formatAuctionAmount", () => {
  assert.equal(formatAuctionAmount("165"), "$165");
  assert.equal(formatAuctionAmount(undefined), null);
});

test("parseTimerEndAt rejects invalid", () => {
  assert.equal(parseTimerEndAt(undefined), null);
  assert.equal(parseTimerEndAt("not-a-date"), null);
});
