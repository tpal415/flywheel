/**
 * Strategy settings: globally defined defaults, strategy mode, and per-ticker
 * overrides including assignment intent.
 */

// ---------------------------------------------------------------------------
// Assignment preference — drives strike selection, delta, and scoring
// ---------------------------------------------------------------------------

/**
 * Per-ticker assignment intent:
 *   - "avoid"  — keep shares, prefer far OTM, enforce min upside
 *   - "neutral" — standard wheel rules
 *   - "prefer" — happy to get called away, tighter strikes OK
 */
export type AssignmentPreference = 'avoid' | 'neutral' | 'prefer';

// ---------------------------------------------------------------------------
// Strategy mode — global tilt for the entire portfolio
// ---------------------------------------------------------------------------

/**
 * Global strategy posture:
 *   - "incomeFocused" — higher deltas, shorter DTE, maximize premium
 *   - "balanced"      — default middle ground
 *   - "upsideFocused" — lower deltas, longer DTE, protect upside
 */
export type StrategyMode = 'incomeFocused' | 'balanced' | 'upsideFocused';

/**
 * Delta range adjustments applied by strategy mode on top of the configured
 * targetDeltaRange. These shift the effective range.
 */
export function strategyModeDeltaShift(mode: StrategyMode): readonly [number, number] {
  switch (mode) {
    case 'incomeFocused':
      return [0.05, 0.05];
    case 'balanced':
      return [0, 0];
    case 'upsideFocused':
      return [-0.05, -0.05];
  }
}

/**
 * DTE preference multiplier applied by strategy mode. >1 means prefer
 * longer-dated expirations in scoring; <1 means prefer shorter.
 */
export function strategyModeDteMultiplier(mode: StrategyMode): number {
  switch (mode) {
    case 'incomeFocused':
      return 0.8;
    case 'balanced':
      return 1.0;
    case 'upsideFocused':
      return 1.2;
  }
}

// ---------------------------------------------------------------------------
// Roll settings
// ---------------------------------------------------------------------------

export interface RollSettings {
  readonly deltaThreshold: number;
  readonly dteRatioThreshold: number;
  readonly nearStrikePct: number;
  readonly minDte: number;
  readonly profitCapturePct: number;
}

// ---------------------------------------------------------------------------
// Global strategy settings
// ---------------------------------------------------------------------------

export interface StrategySettings {
  readonly strategyMode: StrategyMode;
  readonly targetDeltaRange: readonly [number, number];
  readonly minDTE: number;
  readonly maxDTE: number;
  readonly minPremiumPct: number;
  readonly minAnnualizedYield: number;
  readonly roll: RollSettings;
  /** Global default max contracts to recommend per ticker. 0 = no limit. */
  readonly maxContractsPerTicker: number;
}

// ---------------------------------------------------------------------------
// Per-ticker override
// ---------------------------------------------------------------------------

export interface TickerOverride {
  readonly symbol: string;
  readonly note?: string;
  readonly assignmentPreference?: AssignmentPreference;
  /** If true, the scoring engine penalizes capping upside too early. */
  readonly compounder?: boolean;
  /** Minimum upside % before assignment. Enforced as a hard filter for "avoid". */
  readonly minUpsidePct?: number;
  readonly targetDeltaRange?: readonly [number, number];
  readonly minDTE?: number;
  readonly maxDTE?: number;
  readonly minPremiumPct?: number;
  readonly minAnnualizedYield?: number;
  /** Cap position size. 0 = no limit. Overrides global default. */
  readonly maxContractsPerTicker?: number;
  readonly roll?: Partial<RollSettings>;
}

// ---------------------------------------------------------------------------
// Effective settings (merge global + override)
// ---------------------------------------------------------------------------

export interface EffectiveTickerSettings {
  readonly targetDeltaRange: readonly [number, number];
  readonly minDTE: number;
  readonly maxDTE: number;
  readonly minPremiumPct: number;
  readonly minAnnualizedYield: number;
  readonly roll: RollSettings;
  readonly assignmentPreference: AssignmentPreference;
  readonly compounder: boolean;
  readonly minUpsidePct: number;
  readonly strategyMode: StrategyMode;
  /** 0 = no limit; >0 = cap the recommended contract count. */
  readonly maxContractsPerTicker: number;
}

/**
 * Merge global settings + strategy mode adjustments + ticker override into
 * the effective settings used by the engine for one symbol.
 */
export function effectiveSettings(
  global: StrategySettings,
  override: TickerOverride | undefined,
): EffectiveTickerSettings {
  const mode = global.strategyMode;
  const [dLo, dHi] = strategyModeDeltaShift(mode);

  // Base delta range from override or global, then shift by mode.
  const baseDelta = override?.targetDeltaRange ?? global.targetDeltaRange;
  const deltaRange: readonly [number, number] = [
    Math.max(0.01, baseDelta[0] + dLo),
    Math.min(0.99, baseDelta[1] + dHi),
  ];

  // Assignment preference defaults to "neutral".
  const assignmentPreference = override?.assignmentPreference ?? 'neutral';

  // For "avoid" tickers without an explicit minUpsidePct, default to 5%.
  const defaultMinUpside = assignmentPreference === 'avoid' ? 0.05 : 0;
  const minUpsidePct = override?.minUpsidePct ?? defaultMinUpside;

  return {
    targetDeltaRange: deltaRange,
    minDTE: override?.minDTE ?? global.minDTE,
    maxDTE: override?.maxDTE ?? global.maxDTE,
    minPremiumPct: override?.minPremiumPct ?? global.minPremiumPct,
    minAnnualizedYield:
      override?.minAnnualizedYield ?? global.minAnnualizedYield,
    roll: {
      deltaThreshold:
        override?.roll?.deltaThreshold ?? global.roll.deltaThreshold,
      dteRatioThreshold:
        override?.roll?.dteRatioThreshold ?? global.roll.dteRatioThreshold,
      nearStrikePct:
        override?.roll?.nearStrikePct ?? global.roll.nearStrikePct,
      minDte: override?.roll?.minDte ?? global.roll.minDte,
      profitCapturePct:
        override?.roll?.profitCapturePct ?? global.roll.profitCapturePct,
    },
    assignmentPreference,
    compounder: override?.compounder ?? false,
    minUpsidePct,
    strategyMode: mode,
    maxContractsPerTicker:
      override?.maxContractsPerTicker ?? global.maxContractsPerTicker,
  };
}
