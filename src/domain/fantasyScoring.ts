/**
 * League-agnostic fantasy scoring from nflverse box-score components.
 * nflverse only ships std + PPR; all custom presets are recomputed here.
 */

export type ReceptionScoring = "standard" | "half_ppr" | "ppr";

export interface ScoringPreset {
  receptions: ReceptionScoring;
  /** Points per passing TD (typically 4 or 6). */
  passTd: 4 | 6;
  /** Extra points per TE reception beyond the base reception scoring (e.g. 0.5). */
  tePremium: number;
  passYard: number;
  rushYard: number;
  recYard: number;
  rushTd: number;
  recTd: number;
  interception: number;
  fumbleLost: number;
}

export const DEFAULT_SCORING: ScoringPreset = {
  receptions: "ppr",
  passTd: 4,
  tePremium: 0,
  passYard: 0.04,
  rushYard: 0.1,
  recYard: 0.1,
  rushTd: 6,
  recTd: 6,
  interception: -2,
  fumbleLost: -2,
};

export function receptionPoints(preset: ScoringPreset): number {
  if (preset.receptions === "ppr") return 1;
  if (preset.receptions === "half_ppr") return 0.5;
  return 0;
}

export interface BoxScoreComponents {
  position?: string | null;
  passingYards?: number | null;
  passingTds?: number | null;
  interceptions?: number | null;
  carries?: number | null;
  rushingYards?: number | null;
  rushingTds?: number | null;
  rushingFumblesLost?: number | null;
  targets?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTds?: number | null;
  receivingFumblesLost?: number | null;
}

export interface ExpectedComponents {
  receptionsExp?: number | null;
  receivingYardsExp?: number | null;
  receivingTdsExp?: number | null;
  rushingYardsExp?: number | null;
  rushingTdsExp?: number | null;
  passingYardsExp?: number | null;
  passingTdsExp?: number | null;
}

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function scoreBox(box: BoxScoreComponents, preset: ScoringPreset = DEFAULT_SCORING): number {
  const pos = (box.position ?? "").toUpperCase();
  const recPts = receptionPoints(preset) + (pos === "TE" ? preset.tePremium : 0);
  const fumbles = n(box.rushingFumblesLost) + n(box.receivingFumblesLost);
  return (
    n(box.passingYards) * preset.passYard +
    n(box.passingTds) * preset.passTd +
    n(box.interceptions) * preset.interception +
    n(box.rushingYards) * preset.rushYard +
    n(box.rushingTds) * preset.rushTd +
    n(box.receivingYards) * preset.recYard +
    n(box.receivingTds) * preset.recTd +
    n(box.receptions) * recPts +
    fumbles * preset.fumbleLost
  );
}

/** Recompute expected fantasy points under the same scoring toggle weights. */
export function scoreExpected(exp: ExpectedComponents, position?: string | null, preset: ScoringPreset = DEFAULT_SCORING): number {
  const pos = (position ?? "").toUpperCase();
  const recPts = receptionPoints(preset) + (pos === "TE" ? preset.tePremium : 0);
  return (
    n(exp.passingYardsExp) * preset.passYard +
    n(exp.passingTdsExp) * preset.passTd +
    n(exp.rushingYardsExp) * preset.rushYard +
    n(exp.rushingTdsExp) * preset.rushTd +
    n(exp.receivingYardsExp) * preset.recYard +
    n(exp.receivingTdsExp) * preset.recTd +
    n(exp.receptionsExp) * recPts
  );
}

export function parseScoringQuery(q: URLSearchParams): ScoringPreset {
  const receptionsRaw = (q.get("scoring") ?? "ppr").toLowerCase();
  const receptions: ReceptionScoring =
    receptionsRaw === "standard" || receptionsRaw === "std"
      ? "standard"
      : receptionsRaw === "half" || receptionsRaw === "half_ppr"
        ? "half_ppr"
        : "ppr";
  const passTdRaw = Number(q.get("passTd") ?? "4");
  const passTd: 4 | 6 = passTdRaw === 6 ? 6 : 4;
  const tePrem = q.get("tePremium");
  const tePremium = tePrem === "1" || tePrem === "true" || tePrem === "0.5" ? 0.5 : Number(tePrem ?? "0") || 0;
  return { ...DEFAULT_SCORING, receptions, passTd, tePremium };
}

export function scoringPresetKey(p: ScoringPreset): string {
  return `${p.receptions}|passTd=${p.passTd}|te=${p.tePremium}`;
}
