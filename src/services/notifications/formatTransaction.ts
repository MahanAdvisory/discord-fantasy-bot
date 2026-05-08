import type { SleeperTransaction } from "../../sleeper/transactionsApi.js";
import type { NotificationCategory } from "../../domain/notifications.js";

/** Map Sleeper transaction to which notification categories should receive it. */
export function categoriesForTransaction(tx: SleeperTransaction): NotificationCategory[] {
  if (tx.type === "trade") return ["transactions"];
  if (tx.type === "free_agent" || tx.type === "waiver") {
    const faab =
      tx.settings?.waiver_bid ??
      (tx.metadata?.waiver_bid ? parseInt(String(tx.metadata.waiver_bid), 10) : undefined);
    if (faab != null && faab > 0) return ["waivers"];
    if (tx.type === "waiver") return ["waivers"];
    return ["transactions"];
  }
  return ["transactions"];
}

function playerRef(playerId: string, labels?: Map<string, string>): string {
  const label = labels?.get(playerId);
  return label ? `${label}` : `\`${playerId}\``;
}

function rosterName(rosterId: number, rosterLabels?: Map<number, string>): string {
  return rosterLabels?.get(rosterId) ?? `roster ${rosterId}`;
}

function formatDraftPick(dp: {
  season?: string;
  round?: number;
  roster_id?: number;
  previous_owner_id?: number;
  owner_id?: number;
}, opts?: { rosterLabels?: Map<number, string>; draftSlotsBySeason?: Map<string, Map<number, number>> }): string {
  const season = dp.season ?? "?";
  const round = dp.round ?? "?";
  const originRoster = dp.roster_id;
  if (originRoster != null && typeof season === "string") {
    const seasonSlots = opts?.draftSlotsBySeason?.get(season);
    const slot = seasonSlots?.get(originRoster);
    if (slot != null) {
      return `${season} ${round}.${String(slot).padStart(2, "0")}`;
    }
  }
  if (originRoster != null) {
    const who = opts?.rosterLabels?.get(originRoster) ?? `roster ${originRoster}`;
    return `${season} Round ${round} (${who})`;
  }
  if (dp.previous_owner_id != null) {
    const who = opts?.rosterLabels?.get(dp.previous_owner_id) ?? `roster ${dp.previous_owner_id}`;
    return `${season} Round ${round} (${who})`;
  }
  return `${season} Round ${round}`;
}

export function formatTransactionLine(
  tx: SleeperTransaction,
  leagueName: string,
  playerLabels?: Map<string, string>,
  rosterLabels?: Map<number, string>,
  draftSlotsBySeason?: Map<string, Map<number, number>>,
): string {
  if (tx.type === "trade") {
    const receives = new Map<number, string[]>();
    const rosterIds = [...new Set(tx.roster_ids ?? [])].filter((n): n is number => typeof n === "number");
    for (const rid of rosterIds) receives.set(rid, []);

    for (const [playerId, rosterId] of Object.entries(tx.adds ?? {})) {
      if (typeof rosterId !== "number") continue;
      if (!receives.has(rosterId)) receives.set(rosterId, []);
      receives.get(rosterId)!.push(playerRef(playerId, playerLabels));
    }

    for (const dp of tx.draft_picks ?? []) {
      if (typeof dp.owner_id !== "number") continue;
      if (!receives.has(dp.owner_id)) receives.set(dp.owner_id, []);
      receives.get(dp.owner_id)!.push(
        formatDraftPick(dp, {
          rosterLabels,
          draftSlotsBySeason,
        }),
      );
    }

    const parties =
      rosterIds.length >= 2
        ? `${rosterName(rosterIds[0], rosterLabels)} vs ${rosterName(rosterIds[1], rosterLabels)}`
        : rosterIds.length === 1
          ? rosterName(rosterIds[0], rosterLabels)
          : "multi-team";

    const lines: string[] = [];
    lines.push(`**${leagueName}** — Trade: ${parties} (status: ${tx.status})`);
    const ordered = [...new Set([...rosterIds, ...receives.keys()])];
    for (const rid of ordered) {
      const items = receives.get(rid) ?? [];
      const who = rosterName(rid, rosterLabels);
      lines.push(`**${who} receives:** ${items.length ? items.join(", ") : "—"}`);
    }
    return lines.join("\n");
  }

  const type = tx.type === "trade" ? "Trade" : tx.type === "free_agent" ? "Waiver/FA" : tx.type;
  const addIds = Object.keys(tx.adds ?? {});
  const dropIds = Object.keys(tx.drops ?? {});
  const adds = addIds.length;
  const deltaBits: string[] = [];
  if (adds) deltaBits.push(`${adds} add${adds === 1 ? "" : "s"}`);
  const delta = deltaBits.length ? ` · ${deltaBits.join(", ")}` : "";
  const detailParts: string[] = [];
  if (addIds.length) {
    detailParts.push(
      `adds: ${addIds
        .slice(0, 5)
        .map((id) => {
          const rosterId = tx.adds?.[id];
          const who = typeof rosterId === "number" ? rosterLabels?.get(rosterId) : null;
          return who ? `${playerRef(id, playerLabels)} -> ${who}` : playerRef(id, playerLabels);
        })
        .join(", ")}`,
    );
  }
  if (dropIds.length) {
    detailParts.push(
      `drops: ${dropIds
        .slice(0, 5)
        .map((id) => {
          const rosterId = tx.drops?.[id];
          const who = typeof rosterId === "number" ? rosterLabels?.get(rosterId) : null;
          return who ? `${playerRef(id, playerLabels)} <- ${who}` : playerRef(id, playerLabels);
        })
        .join(", ")}`,
    );
  }
  const detail = detailParts.length ? `\n_${detailParts.join(" · ")}_` : "";
  return `**${leagueName}** — ${type}${delta} (status: ${tx.status})${detail}`;
}
