/**
 * Strategy settings: globally defined defaults and per-ticker overrides.
 */

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
  /**
   * When a short option's |delta| exceeds this value, the roll engine fires.
   */
  readonly rollTriggerDelta: number;
  /**
   * When remaining DTE / original DTE falls below this fraction AND the
   * position is ITM / threatened, the roll engine fires.
   */
  readonly rollTriggerDtePct: number;
  /**
   * Maximum number of recommendations to return per symbol per action type.
   */
  readonly maxRecommendationsPerSymbol: number;
}

/**
 * Override that can be applied on top of the global defaults.
 * Every field is optional; present fields overwrite global values.
 */
export type TickerOverride = { readonly symbol: string } & Partial<
  Omit<StrategySettings, never>
>;

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
    rollTriggerDelta: override.rollTriggerDelta ?? global.rollTriggerDelta,
    rollTriggerDtePct: override.rollTriggerDtePct ?? global.rollTriggerDtePct,
    maxRecommendationsPerSymbol:
      override.maxRecommendationsPerSymbol ??
      global.maxRecommendationsPerSymbol,
  };
}
