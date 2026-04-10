/**
 * Discriminated-union recommendation and alert types emitted by the engine.
 */

import type { OptionContract } from './chains.js';

export type RecommendationAction =
  | 'SELL_CC'
  | 'SELL_CSP'
  | 'ROLL'
  | 'HOLD'
  | 'CLOSE';

/**
 * Style tag based on delta:
 *   - Safer:    |delta| < 0.20 — more room to run, lower premium
 *   - Balanced: |delta| 0.20–0.30
 *   - Income:   |delta| > 0.30 — higher premium, more assignment risk
 */
export type StyleTag = 'Safer' | 'Balanced' | 'Income';

export function styleTagFromDelta(absDelta: number): StyleTag {
  if (absDelta < 0.2) return 'Safer';
  if (absDelta <= 0.3) return 'Balanced';
  return 'Income';
}

/**
 * Named roll trigger labels for explainability.
 */
export type RollTriggerLabel =
  | 'DELTA'
  | 'DTE_RATIO'
  | 'NEAR_STRIKE'
  | 'MIN_DTE'
  | 'PROFIT_CAPTURE';

export interface RollTriggerDetail {
  readonly label: RollTriggerLabel;
  readonly message: string;
}

export interface BaseRecommendation {
  readonly symbol: string;
  readonly action: RecommendationAction;
  readonly contract: OptionContract;
  /** ISO date string of the expiration for convenience. */
  readonly expiration: string;
  /** Current underlying price used for the recommendation. */
  readonly currentPrice: number;
  /** Number of contracts that can be written against uncovered shares / cash. */
  readonly contractsAvailable: number;
  /** Premium in dollars per contract (mid * 100). */
  readonly premium: number;
  /** Total premium across all available contracts. */
  readonly totalPremium: number;
  /** Raw cycle yield: premium / notional (not annualized). */
  readonly cycleYield: number;
  /** For CCs: (strike - spot)/spot. For CSPs: (spot - strike)/spot. */
  readonly upsidePct: number;
  readonly annualizedYield: number;
  /** Approximation of P(assignment) — documented as |delta|. */
  readonly assignmentProb: number;
  readonly score: number;
  readonly styleTag: StyleTag;
  readonly rationale: readonly string[];
  /** Liquidity / data quality warnings for this specific contract. */
  readonly warnings: readonly string[];
  /** True if contractsAvailable was capped by maxContractsPerTicker. */
  readonly positionCapped: boolean;
}

export interface SellCoveredCallRecommendation extends BaseRecommendation {
  readonly action: 'SELL_CC';
}

export interface SellCashSecuredPutRecommendation extends BaseRecommendation {
  readonly action: 'SELL_CSP';
  /** Cash reserve required for one contract (strike * 100). */
  readonly cashRequired: number;
}

export interface RollRecommendation extends BaseRecommendation {
  readonly action: 'ROLL';
  readonly relatedPositionId: string;
  /** Net credit received on the roll in dollars. */
  readonly netCredit: number;
  /** Which trigger(s) fired. */
  readonly triggers: readonly RollTriggerDetail[];
}

export interface HoldRecommendation extends BaseRecommendation {
  readonly action: 'HOLD';
}

export interface CloseRecommendation extends BaseRecommendation {
  readonly action: 'CLOSE';
  readonly relatedPositionId: string;
}

export type Recommendation =
  | SellCoveredCallRecommendation
  | SellCashSecuredPutRecommendation
  | RollRecommendation
  | HoldRecommendation
  | CloseRecommendation;

export type AlertSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface Alert {
  readonly severity: AlertSeverity;
  readonly symbol: string;
  readonly message: string;
  readonly relatedPositionId?: string;
}
