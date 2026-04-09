/**
 * Strategy settings: globally defined defaults and per-ticker overrides.
 */

export interface RollSettings {
  /** When |delta| exceeds this, the delta trigger fires. */
  readonly deltaThreshold: number;
  /** When remaining DTE / original DTE falls below this, the DTE-ratio trigger fires. */
  readonly dteRatioThreshold: number;
  /** When |spot - strike| / spot <= this, the near-strike trigger fires. */
  readonly nearStrikePct: number;
  /** When remaining DTE <= this, the min-DTE trigger fires regardless. */
  readonly minDte: number;
  /** When (openPrice - currentMid) / openPrice >= this, the profit-capture trigger fires. */
  readonly profitCapturePct: number;
}

export interface StrategySettings {
  /** Absolute delta range the engine will consider (inclusive). */
  readonly targetDeltaRange: readonly [number, number];
  readonly minDTE: number;
  readonly maxDTE: number;
  /**
   * Minimum premium as a fraction of the underlying's notional value.
   * e.g. 0.005 means premium / (spot * 100) must be at least 0.5%.
   */
  readonly minPremiumPct: number;
  /** Minimum annualized yield (premium/notional) * (365/DTE). */
  readonly minAnnualizedYield: number;
  /** Maximum number of recommendations to return per symbol per action type. */
  readonly maxRecommendationsPerSymbol: number;
  /** Roll trigger thresholds. */
  readonly roll: RollSettings;
}

/**
 * Override applied on top of global defaults for a specific ticker.
 * Present fields overwrite global values. `note` is for human documentation.
 */
export interface TickerOverride {
  readonly symbol: string;
  readonly note?: string;
  readonly targetDeltaRange?: readonly [number, number];
  readonly minDTE?: number;
  readonly maxDTE?: number;
  readonly minPremiumPct?: number;
  readonly minAnnualizedYield?: number;
  readonly maxRecommendationsPerSymbol?: number;
  readonly roll?: Partial<RollSettings>;
}

/**
 * Merge global settings with a ticker-specific override to compute the
 * effective settings for evaluation of a specific symbol.
 */
export function effectiveSettings(
  global: StrategySettings,
  override: TickerOverride | undefined,
): StrategySettings {
  if (!override) return global;
  return {
    targetDeltaRange: override.targetDeltaRange ?? global.targetDeltaRange,
    minDTE: override.minDTE ?? global.minDTE,
    maxDTE: override.maxDTE ?? global.maxDTE,
    minPremiumPct: override.minPremiumPct ?? global.minPremiumPct,
    minAnnualizedYield:
      override.minAnnualizedYield ?? global.minAnnualizedYield,
    maxRecommendationsPerSymbol:
      override.maxRecommendationsPerSymbol ??
      global.maxRecommendationsPerSymbol,
    roll: {
      deltaThreshold:
        override.roll?.deltaThreshold ?? global.roll.deltaThreshold,
      dteRatioThreshold:
        override.roll?.dteRatioThreshold ?? global.roll.dteRatioThreshold,
      nearStrikePct:
        override.roll?.nearStrikePct ?? global.roll.nearStrikePct,
      minDte: override.roll?.minDte ?? global.roll.minDte,
      profitCapturePct:
        override.roll?.profitCapturePct ?? global.roll.profitCapturePct,
    },
  };
}
