-- AlterTable
ALTER TABLE "draft_poll_cursors" ADD COLUMN "last_nominated_player_id" TEXT,
ADD COLUMN "last_highest_offer" TEXT,
ADD COLUMN "last_offering_user_id" TEXT,
ADD COLUMN "last_timer_warned_end_at" TEXT,
ADD COLUMN "last_auction_action_at" TEXT;
