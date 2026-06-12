import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAuctionAmount,
  formatTimerRemaining,
  isAuctionDraft,
  isAuctionTimerExpiringSoon,
  auctionDraftStatusLines,
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

test("formatTimerRemaining handles minutes, hours, and days", () => {
  const now = new Date("2026-06-13T03:00:00.000Z");
  assert.equal(formatTimerRemaining("2026-06-13T03:09:00.000Z", now), "~9 min");
  assert.equal(formatTimerRemaining("2026-06-13T05:30:00.000Z", now), "~2h 30m");
  assert.equal(formatTimerRemaining("2026-06-15T03:00:00.000Z", now), "~2d");
  assert.equal(formatTimerRemaining("2026-06-13T02:59:00.000Z", now), "expired");
  assert.equal(formatTimerRemaining(undefined), "—");
});

test("parseTimerEndAt rejects invalid", () => {
  assert.equal(parseTimerEndAt(undefined), null);
  assert.equal(parseTimerEndAt("not-a-date"), null);
});

test("auctionDraftStatusLines shows block, bid, and last won", () => {
  const now = new Date("2026-06-13T03:00:00.000Z");
  const lines = auctionDraftStatusLines({
    status: "drafting",
    metadata: {
      nominated_player_id: "12507",
      nominating_user_id: "u1",
      offering_user_id: "u2",
      highest_offer: "165",
      timer_end_at: "2026-06-13T03:09:00.000Z",
    },
    picks: [
      {
        pick_no: 1,
        picked_by: "u3",
        player_id: "4984",
        metadata: { first_name: "Josh", last_name: "Allen", position: "QB", team: "BUF", amount: "242" },
      },
    ],
    teamLabel: (id) => ({ u1: "Nominator", u2: "Bidder", u3: "Winner" })[id ?? ""] ?? "?",
    playerLabel: (id) => (id === "12507" ? "Omarion Hampton (RB, LAC)" : id),
    now,
  });
  assert.ok(lines.some((l) => l.includes("On the block") && l.includes("Omarion Hampton")));
  assert.ok(lines.some((l) => l.includes("Time left") && l.includes("~9 min")));
  assert.ok(lines.some((l) => l.includes("High bid") && l.includes("$165") && l.includes("Bidder")));
  assert.ok(lines.some((l) => l.includes("Last won") && l.includes("$242") && l.includes("Winner")));
});
