import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { log } from "../../logging.js";

export type NotificationJournalKind =
  | "transaction"
  | "draft_pick"
  | "draft_on_clock"
  | "draft_auction_nomination"
  | "draft_auction_bid"
  | "draft_auction_timer";

export interface NotificationJournalInput {
  eventKey: string;
  kind: NotificationJournalKind;
  leagueId?: string | null;
  draftId?: string | null;
  transactionId?: string | null;
  season?: string | null;
  week?: number | null;
  pickNo?: number | null;
  targetCount: number;
  meta?: Prisma.InputJsonValue;
}

/** Stable idempotency / audit keys (versioned prefix for future migrations). */
export const journalKeys = {
  transaction: (leagueId: string, transactionId: string) => `sleeper:v1:tx:${leagueId}:${transactionId}`,
  draftPick: (draftId: string, pickNo: number) => `sleeper:v1:draft:pick:${draftId}:${pickNo}`,
  draftOnClock: (draftId: string, sequencePick: number) => `sleeper:v1:draft:clock:${draftId}:${sequencePick}`,
  draftAuctionNomination: (draftId: string, playerId: string) =>
    `sleeper:v1:draft:auction:nom:${draftId}:${playerId}`,
  draftAuctionBid: (draftId: string, playerId: string, amount: string, offeringUserId: string) =>
    `sleeper:v1:draft:auction:bid:${draftId}:${playerId}:${amount}:${offeringUserId}`,
  draftAuctionTimer: (draftId: string, playerId: string, timerEndAt: string) =>
    `sleeper:v1:draft:auction:timer:${draftId}:${playerId}:${timerEndAt}`,
};

/**
 * Append-only record of a notification fan-out we completed. Unique `eventKey` catches rare double-runs
 * (e.g. overlapping workers); duplicates are downgraded to a warning.
 */
export async function recordNotificationJournalEntry(input: NotificationJournalInput): Promise<boolean> {
  try {
    await prisma.notificationEventJournal.create({
      data: {
        eventKey: input.eventKey,
        kind: input.kind,
        leagueId: input.leagueId ?? undefined,
        draftId: input.draftId ?? undefined,
        transactionId: input.transactionId ?? undefined,
        season: input.season ?? undefined,
        week: input.week ?? undefined,
        pickNo: input.pickNo ?? undefined,
        targetCount: input.targetCount,
        meta: input.meta ?? undefined,
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      log.warn("notification_journal_duplicate_event_key", { eventKey: input.eventKey, kind: input.kind });
      return false;
    }
    throw e;
  }
}

export async function finalizeNotificationJournalEntry(
  eventKey: string,
  targetCount: number,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.notificationEventJournal.update({
    where: { eventKey },
    data: {
      targetCount,
      ...(meta === undefined ? {} : { meta }),
    },
  });
}
