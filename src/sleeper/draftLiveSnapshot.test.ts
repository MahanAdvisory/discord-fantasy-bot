import assert from "node:assert/strict";
import test from "node:test";
import { formatAuctionAmount, pickPlayerSummary } from "./auctionDraft.js";
import { buildDraftLiveSnapshot } from "./draftLiveSnapshot.js";

test("pickPlayerSummary and amount on last pick shape", () => {
  const summary = pickPlayerSummary({
    player_id: "4984",
    metadata: { first_name: "Josh", last_name: "Allen", position: "QB", team: "BUF" },
  });
  assert.equal(summary, "Josh Allen (QB, BUF)");
  assert.equal(formatAuctionAmount("242"), "$242");
});

test("buildDraftLiveSnapshot returns auction fields", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/draft/d1/picks")) {
      return Response.json([
        {
          pick_no: 1,
          picked_by: "u3",
          player_id: "4984",
          metadata: { first_name: "Josh", last_name: "Allen", position: "QB", team: "BUF", amount: "242" },
        },
      ]);
    }
    if (url.includes("/draft/d1")) {
      return Response.json({
        draft_id: "d1",
        status: "drafting",
        type: "auction",
        metadata: {
          nominated_player_id: "12507",
          nominating_user_id: "u1",
          offering_user_id: "u2",
          highest_offer: "165",
          timer_end_at: "2099-01-01T00:10:00.000Z",
        },
      });
    }
    if (url.includes("/league/L1/users")) {
      return Response.json([
        { user_id: "u1", username: "Nominator" },
        { user_id: "u2", username: "Bidder" },
        { user_id: "u3", username: "Winner" },
      ]);
    }
    if (url.includes("/players/nfl")) {
      return Response.json({ "12507": { first_name: "Omarion", last_name: "Hampton", position: "RB", team: "LAC" } });
    }
    return Response.json(null, { status: 404 });
  };

  const snap = await buildDraftLiveSnapshot("L1", "d1");
  assert.ok(snap);
  assert.equal(snap!.draftType, "auction");
  assert.ok(snap!.auction);
  assert.equal(snap!.auction!.highBid, "$165");
  assert.equal(snap!.auction!.highBidder, "Bidder");
  assert.equal(snap!.auction!.onTheBlock, "Omarion Hampton (RB, LAC)");
  assert.equal(snap!.lastPick?.winner, "Winner");
  assert.equal(snap!.lastPick?.player, "Josh Allen (QB, BUF)");
  assert.equal(snap!.lastPick?.amount, "$242");
});
