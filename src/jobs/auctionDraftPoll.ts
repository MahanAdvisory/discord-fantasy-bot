import type { Client } from "discord.js";
import { log } from "../logging.js";
import { runAuctionDraftFastPoll } from "../services/notifications/runPoll.js";

const AUCTION_FAST_POLL_MS = 60_000;

/**
 * While an auction draft has a player on the block with a timer expiring within 10 minutes,
 * poll every minute (in addition to the hourly digest) so bid and timer alerts land in time.
 */
export function scheduleAuctionDraftFastPoll(client: Client): void {
  setInterval(() => {
    void runAuctionDraftFastPoll(client).catch((err) =>
      log.error("auction_fast_poll_failed", { err: err instanceof Error ? err.message : String(err) }),
    );
  }, AUCTION_FAST_POLL_MS);
  void runAuctionDraftFastPoll(client).catch((err) =>
    log.error("auction_fast_poll_initial_failed", { err: err instanceof Error ? err.message : String(err) }),
  );
}
