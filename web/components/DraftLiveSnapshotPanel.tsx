type DraftLastPick = {
  pickNo: number;
  player: string;
  amount: string | null;
  winner: string;
};

type DraftAuction = {
  onTheBlock: string | null;
  timeLeft: string;
  highBid: string | null;
  highBidder: string | null;
  nominatedBy: string | null;
};

export type DraftLiveSnapshotView = {
  draftId: string;
  draftType?: string | null;
  picksComplete: number;
  nextPickNumber: number;
  draftUrl: string;
  onTheClock?: string | null;
  lastPick?: DraftLastPick | null;
  auction?: DraftAuction | null;
};

export function DraftLiveSnapshotPanel({
  snapshot,
  showPickProgress = true,
}: {
  snapshot: DraftLiveSnapshotView;
  showPickProgress?: boolean;
}) {
  const isAuction = snapshot.draftType?.toLowerCase() === "auction" || snapshot.auction != null;

  return (
    <div className="space-y-2 text-sm">
      {showPickProgress && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p>
            <span className="text-zinc-600 dark:text-zinc-400">
              {isAuction ? "Picks complete:" : "Next pick:"}
            </span>{" "}
            {isAuction ? (
              <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.picksComplete}</strong>
            ) : (
              <>
                <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.nextPickNumber}</strong>
                <span className="text-zinc-500"> ({snapshot.picksComplete} completed)</span>
              </>
            )}
            {snapshot.draftType ? (
              <span className="ml-2 text-xs uppercase text-zinc-500">{snapshot.draftType}</span>
            ) : null}
          </p>
          <a
            href={snapshot.draftUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-blue-600 underline dark:text-blue-400"
          >
            Open draft
          </a>
        </div>
      )}

      {isAuction && snapshot.auction ? (
        <>
          <p>
            <span className="text-zinc-600 dark:text-zinc-400">On the block:</span>{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">
              {snapshot.auction.onTheBlock ?? "—"}
            </strong>
          </p>
          <p>
            <span className="text-zinc-600 dark:text-zinc-400">Time left:</span>{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.auction.timeLeft}</strong>
          </p>
          <p>
            <span className="text-zinc-600 dark:text-zinc-400">High bid:</span>{" "}
            {snapshot.auction.highBid ? (
              <>
                <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.auction.highBid}</strong>
                {snapshot.auction.highBidder ? (
                  <>
                    {" "}
                    <span className="text-zinc-600 dark:text-zinc-400">by</span>{" "}
                    <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.auction.highBidder}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-zinc-500">No bids yet</span>
            )}
          </p>
          {snapshot.auction.nominatedBy ? (
            <p>
              <span className="text-zinc-600 dark:text-zinc-400">Nominated by:</span>{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.auction.nominatedBy}</strong>
            </p>
          ) : null}
        </>
      ) : (
        <p>
          <span className="text-zinc-600 dark:text-zinc-400">On the clock:</span>{" "}
          <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.onTheClock ?? "—"}</strong>
        </p>
      )}

      {snapshot.lastPick ? (
        <p>
          <span className="text-zinc-600 dark:text-zinc-400">
            Last {isAuction ? "won" : "pick"} (#{snapshot.lastPick.pickNo}):
          </span>{" "}
          <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.lastPick.player}</strong>
          {snapshot.lastPick.amount ? (
            <>
              {" "}
              for <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.lastPick.amount}</strong>
            </>
          ) : null}
          {" → "}
          <strong className="text-zinc-900 dark:text-zinc-100">{snapshot.lastPick.winner}</strong>
        </p>
      ) : (
        <p className="text-zinc-500">No picks yet.</p>
      )}
    </div>
  );
}
