-- Product rules: one row per category; route_namespace enforces guild vs DM uniqueness.
-- Migrates from notification_subscriptions.categories TEXT[] to exploded rows.

CREATE TABLE "notification_subscriptions_new" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "guild_id" TEXT,
    "channel_id" TEXT,
    "is_dm" BOOLEAN NOT NULL DEFAULT false,
    "route_namespace" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sleeper',
    "sleeper_league_scope" TEXT NOT NULL,
    "sleeper_draft_id" TEXT,
    "category" TEXT NOT NULL,
    "permission_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_subscriptions_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "notification_subscriptions_new" (
    "id",
    "user_id",
    "guild_id",
    "channel_id",
    "is_dm",
    "route_namespace",
    "provider",
    "sleeper_league_scope",
    "sleeper_draft_id",
    "category",
    "permission_notified_at",
    "created_at",
    "updated_at"
)
SELECT
    md5(random()::text || clock_timestamp()::text || s."user_id"),
    s."user_id",
    s."guild_id",
    s."channel_id",
    s."is_dm",
    CASE
        WHEN s."is_dm" = true THEN 'u:' || s."user_id"
        WHEN s."guild_id" IS NOT NULL THEN 'g:' || s."guild_id"
        ELSE 'u:' || s."user_id"
    END,
    s."provider",
    COALESCE(s."sleeper_league_id", '__all__'),
    s."sleeper_draft_id",
    trim(both from c.cat::text),
    NULL,
    s."created_at",
    CURRENT_TIMESTAMP
FROM "notification_subscriptions" s
    CROSS JOIN LATERAL unnest(s."categories") AS c(cat)
WHERE s."categories" IS NOT NULL
  AND cardinality(s."categories") > 0;

DROP TABLE "notification_subscriptions";

ALTER TABLE "notification_subscriptions_new" RENAME TO "notification_subscriptions";

CREATE UNIQUE INDEX "notification_subscriptions_route_namespace_sleeper_league_scope_category_key"
    ON "notification_subscriptions"("route_namespace", "sleeper_league_scope", "category");

CREATE INDEX "notification_subscriptions_user_id_idx" ON "notification_subscriptions"("user_id");

CREATE INDEX "notification_subscriptions_guild_id_channel_id_idx" ON "notification_subscriptions"("guild_id", "channel_id");

CREATE INDEX "notification_subscriptions_sleeper_league_scope_idx" ON "notification_subscriptions"("sleeper_league_scope");

ALTER TABLE "notification_subscriptions"
    ADD CONSTRAINT "notification_subscriptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
