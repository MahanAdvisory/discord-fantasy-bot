export type WeekChangeDirection = "gain" | "drop";

export type WeekChangeSample = {
  playerKey: string;
  playerName: string | null;
  team: string | null;
  position: string | null;
  startValue: number | null;
  endValue: number | null;
  startVolume: number;
  endVolume: number;
};

export type WeekChange = {
  playerKey: string;
  playerName: string | null;
  team: string | null;
  position: string | null;
  startValue: number;
  endValue: number;
  delta: number;
};

/**
 * Rank players by the change in one metric between two weeks.
 * Both weeks must have a value, and both must meet `minVolume` when it is above zero.
 */
export function rankWeekChanges(
  samples: WeekChangeSample[],
  args: { direction: WeekChangeDirection; minVolume: number; limit: number },
): WeekChange[] {
  const minVolume = Math.max(0, args.minVolume);
  const limit = Math.max(1, args.limit);
  const ranked: WeekChange[] = [];
  for (const sample of samples) {
    if (sample.startValue == null || sample.endValue == null) continue;
    if (!Number.isFinite(sample.startValue) || !Number.isFinite(sample.endValue)) continue;
    if (minVolume > 0 && (sample.startVolume < minVolume || sample.endVolume < minVolume)) continue;
    const delta = sample.endValue - sample.startValue;
    if (args.direction === "gain" && delta <= 0) continue;
    if (args.direction === "drop" && delta >= 0) continue;
    ranked.push({
      playerKey: sample.playerKey,
      playerName: sample.playerName,
      team: sample.team,
      position: sample.position,
      startValue: sample.startValue,
      endValue: sample.endValue,
      delta,
    });
  }
  ranked.sort((a, b) => (args.direction === "drop" ? a.delta - b.delta : b.delta - a.delta));
  return ranked.slice(0, limit);
}
