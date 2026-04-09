/**
 * Scoring engine — assignment-intent-aware, cost-basis-aware, compounder-aware.
 *
 * The score is a weighted sum of normalized components in [0, 1]:
 *
 *   1. Yield         — annualized yield (higher = better)
 *   2. Safety        — 1 - assignmentProb (lower delta = safer)
 *   3. Upside room   — distance from spot (higher = more room to run)
 *   4. Cost basis    — (strike - costBasis) / costBasis (assignment profit margin)
 *
 * Weights shift based on:
 *   - assignmentPreference: "avoid" → safety/upside heavy; "prefer" → yield heavy
 *   - strategyMode: "incomeFocused" → yield heavy; "upsideFocused" → upside heavy
 *   - compounder flag: additional penalty for capping upside too early
 */

import type { AssignmentPreference, StrategyMode } from '../types/settings.js';

export interface ScoreInputs {
  readonly annualizedYield: number;
  readonly distancePct: number;
  readonly assignmentProb: number;
  readonly costBasisMarginPct: number;
  readonly assignmentPreference: AssignmentPreference;
  readonly strategyMode: StrategyMode;
  readonly compounder: boolean;
}

interface Weights {
  yield: number;
  safety: number;
  upside: number;
  costBasis: number;
}

function baseWeights(pref: AssignmentPreference, mode: StrategyMode): Weights {
  // Start from assignment preference.
  let w: Weights;
  switch (pref) {
    case 'avoid':
      w = { yield: 0.20, safety: 0.35, upside: 0.30, costBasis: 0.15 };
      break;
    case 'prefer':
      w = { yield: 0.45, safety: 0.10, upside: 0.15, costBasis: 0.30 };
      break;
    default:
      w = { yield: 0.35, safety: 0.25, upside: 0.20, costBasis: 0.20 };
  }

  // Tilt by strategy mode.
  switch (mode) {
    case 'incomeFocused':
      w.yield += 0.08;
      w.upside -= 0.05;
      w.safety -= 0.03;
      break;
    case 'upsideFocused':
      w.upside += 0.08;
      w.yield -= 0.05;
      w.safety += 0.02;
      w.costBasis -= 0.05;
      break;
  }

  // Renormalize to sum=1.
  const total = w.yield + w.safety + w.upside + w.costBasis;
  w.yield /= total;
  w.safety /= total;
  w.upside /= total;
  w.costBasis /= total;
  return w;
}

/**
 * Compute a score in [0, 1] that reflects how well a candidate fits the
 * user's intent for a given ticker.
 */
export function computeScore(inputs: ScoreInputs): number {
  const w = baseWeights(inputs.assignmentPreference, inputs.strategyMode);

  const yieldNorm = Math.max(0, Math.min(2, inputs.annualizedYield)) / 2;
  const safetyNorm = 1 - Math.max(0, Math.min(1, inputs.assignmentProb));
  const upsideNorm = Math.max(0, Math.min(0.3, inputs.distancePct)) / 0.3;
  const cbNorm = Math.max(0, Math.min(1, inputs.costBasisMarginPct));

  let score =
    w.yield * yieldNorm +
    w.safety * safetyNorm +
    w.upside * upsideNorm +
    w.costBasis * cbNorm;

  // Compounder penalty: if this is a strong compounder and the strike is
  // too close to spot (< 10% upside), apply a penalty that scales with
  // proximity. This discourages capping gains on stocks you expect to run.
  if (inputs.compounder && inputs.distancePct < 0.10) {
    const proximityPenalty = (0.10 - inputs.distancePct) / 0.10; // 0..1
    score *= 1 - 0.25 * proximityPenalty;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Compute annualized yield: (premium / notional) * (365 / dte).
 */
export function annualizedYield(
  premiumDollars: number,
  notionalDollars: number,
  dte: number,
): number {
  if (notionalDollars <= 0 || dte <= 0) return 0;
  return (premiumDollars / notionalDollars) * (365 / dte);
}
