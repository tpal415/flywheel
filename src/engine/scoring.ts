/**
 * Shared scoring helpers used by the CC, CSP, and roll engines.
 *
 * Score is a weighted combination of:
 *   - annualized yield (higher is better)
 *   - distance from spot (higher is better; measured by |upsidePct|)
 *   - (1 - assignmentProb) so lower assignment risk scores higher
 *
 * Weights are fixed and documented here so the CLI output is deterministic.
 */

export const SCORE_WEIGHTS = {
  yield: 0.5,
  distance: 0.25,
  safety: 0.25,
} as const;

/**
 * Combine the three normalized components into a single score in [0, 1].
 *
 * `annualizedYield` is clamped to [0, 2] then divided by 2.
 * `distancePct` is clamped to [0, 0.3] then divided by 0.3.
 * `assignmentProb` is clamped to [0, 1].
 */
export function computeScore(
  annualizedYield: number,
  distancePct: number,
  assignmentProb: number,
): number {
  const yieldNorm = Math.max(0, Math.min(2, annualizedYield)) / 2;
  const distNorm = Math.max(0, Math.min(0.3, distancePct)) / 0.3;
  const safetyNorm = 1 - Math.max(0, Math.min(1, assignmentProb));
  return (
    SCORE_WEIGHTS.yield * yieldNorm +
    SCORE_WEIGHTS.distance * distNorm +
    SCORE_WEIGHTS.safety * safetyNorm
  );
}

/**
 * Compute annualized yield for a short premium trade:
 *   (premium / notional) * (365 / dte)
 *
 * `notional` is the capital tied up: underlying * 100 for CCs (the value of
 * 100 shares), or strike * 100 for CSPs (cash reserve).
 */
export function annualizedYield(
  premiumDollars: number,
  notionalDollars: number,
  dte: number,
): number {
  if (notionalDollars <= 0 || dte <= 0) return 0;
  return (premiumDollars / notionalDollars) * (365 / dte);
}
