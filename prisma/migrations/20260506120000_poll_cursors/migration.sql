-- Phase B: transaction/draft notification dedupe cursors.

CREATE TABLE "league_poll_cursors" (
    "league_id" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "last_transaction_created_ms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "league_poll_cursors_pkey" PRIMARY KEY ("league_id","season","week")
);

CREATE TABLE "draft_poll_cursors" (
    "draft_id" TEXT NOT NULL,
    "last_seen_pick_count" INTEGER NOT NULL DEFAULT 0,
    "last_on_clock_pick_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "draft_poll_cursors_pkey" PRIMARY KEY ("draft_id")
);
