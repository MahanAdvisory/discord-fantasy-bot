-- CreateTable (IF NOT EXISTS: safe if a previous partial apply already created the table)
CREATE TABLE IF NOT EXISTS "league_transaction_notified" (
    "league_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_transaction_notified_pkey" PRIMARY KEY ("league_id","transaction_id")
);
