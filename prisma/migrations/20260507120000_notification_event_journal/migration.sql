-- CreateTable
CREATE TABLE "notification_event_journal" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "league_id" TEXT,
    "draft_id" TEXT,
    "transaction_id" TEXT,
    "season" TEXT,
    "week" INTEGER,
    "pick_no" INTEGER,
    "target_count" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "notification_event_journal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_journal_event_key_key" ON "notification_event_journal"("event_key");

-- CreateIndex
CREATE INDEX "notification_event_journal_league_id_idx" ON "notification_event_journal"("league_id");

-- CreateIndex
CREATE INDEX "notification_event_journal_created_at_idx" ON "notification_event_journal"("created_at");
