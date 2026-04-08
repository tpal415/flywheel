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

export interface BaseRecommendation {
  readonly symbol: string;
  readonly action: RecommendationAction;
  readonly contract: OptionContract;
  /** ISO date string of the expiration for convenience. */
  readonly expiration: string;
  /** Premium in dollars per contract (mid * 100). */
  readonly premium: number;
  /** For CCs: (strike - spot)/spot. For CSPs: (spot - strike)/spot. */
  readonly upsidePct: number;
  readonly annualizedYield: number;
  /** Approximation of P(assignment) — documented as |delta|. */
  readonly assignmentProb: number;
  readonly score: number;
  readonly rationale: readonly string[];
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
