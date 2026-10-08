-- Recurring guild-channel stats reports. Clock is stored as US Eastern weekday/hour.
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "created_by_discord_user_id" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_fired_on" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scheduled_reports_guild_id_channel_id_idx" ON "scheduled_reports"("guild_id", "channel_id");

CREATE INDEX "scheduled_reports_enabled_idx" ON "scheduled_reports"("enabled");
