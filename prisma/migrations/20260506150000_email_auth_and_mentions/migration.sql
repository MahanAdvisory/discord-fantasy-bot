-- Allow account creation without mandatory Discord link.
ALTER TABLE "users" ALTER COLUMN "discord_user_id" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Sleeper user -> Discord mention mappings (per guild).
CREATE TABLE "sleeper_mention_mappings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "guild_id" TEXT NOT NULL,
  "sleeper_user_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sleeper_mention_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sleeper_mention_mappings_guild_id_sleeper_user_id_key"
  ON "sleeper_mention_mappings"("guild_id", "sleeper_user_id");
CREATE INDEX "sleeper_mention_mappings_user_id_guild_id_idx"
  ON "sleeper_mention_mappings"("user_id", "guild_id");

ALTER TABLE "sleeper_mention_mappings"
  ADD CONSTRAINT "sleeper_mention_mappings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
