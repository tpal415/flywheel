import { describe, it, expect } from 'vitest';
import {
  effectiveSettings,
  strategyModeDeltaShift,
  strategyModeDteMultiplier,
  type StrategySettings,
  type TickerOverride,
} from '../src/types/settings.js';

const BASE_SETTINGS: StrategySettings = {
  strategyMode: 'balanced',
  targetDeltaRange: [0.15, 0.35],
  minDTE: 5,
  maxDTE: 50,
  minPremiumPct: 0.003,
  minAnnualizedYield: 0.10,
  roll: {
    deltaThreshold: 0.5,
    dteRatioThreshold: 0.3,
    nearStrikePct: 0.02,
    minDte: 3,
    profitCapturePct: 0.8,
  },
};

describe('strategyModeDeltaShift', () => {
  it('incomeFocused shifts delta UP', () => {
    const [lo, hi] = strategyModeDeltaShift('incomeFocused');
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(0);
  });

  it('balanced has zero shift', () => {
    expect(strategyModeDeltaShift('balanced')).toEqual([0, 0]);
  });

  it('upsideFocused shifts delta DOWN', () => {
    const [lo, hi] = strategyModeDeltaShift('upsideFocused');
    expect(lo).toBeLessThan(0);
    expect(hi).toBeLessThan(0);
  });
});

describe('strategyModeDteMultiplier', () => {
  it('incomeFocused prefers shorter DTE', () => {
    expect(strategyModeDteMultiplier('incomeFocused')).toBeLessThan(1);
  });

  it('balanced is neutral', () => {
    expect(strategyModeDteMultiplier('balanced')).toBe(1.0);
  });

  it('upsideFocused prefers longer DTE', () => {
    expect(strategyModeDteMultiplier('upsideFocused')).toBeGreaterThan(1);
  });
});

describe('effectiveSettings', () => {
  it('returns global settings when no override', () => {
    const eff = effectiveSettings(BASE_SETTINGS, undefined);
    expect(eff.targetDeltaRange).toEqual([0.15, 0.35]);
    expect(eff.assignmentPreference).toBe('neutral');
    expect(eff.compounder).toBe(false);
    expect(eff.minUpsidePct).toBe(0);
  });

  it('overrides only the fields that are set', () => {
    const override: TickerOverride = { symbol: 'X', minDTE: 10 };
    const eff = effectiveSettings(BASE_SETTINGS, override);
    expect(eff.minDTE).toBe(10);
    expect(eff.maxDTE).toBe(50); // not overridden
  });

  it('avoid + no minUpsidePct defaults to 5%', () => {
    const override: TickerOverride = { symbol: 'X', assignmentPreference: 'avoid' };
    const eff = effectiveSettings(BASE_SETTINGS, override);
    expect(eff.minUpsidePct).toBe(0.05);
  });

  it('avoid + explicit minUpsidePct uses the explicit value', () => {
    const override: TickerOverride = {
      symbol: 'X', assignmentPreference: 'avoid', minUpsidePct: 0.12,
    };
    const eff = effectiveSettings(BASE_SETTINGS, override);
    expect(eff.minUpsidePct).toBe(0.12);
  });

  it('prefer + no minUpsidePct defaults to 0', () => {
    const override: TickerOverride = { symbol: 'X', assignmentPreference: 'prefer' };
    const eff = effectiveSettings(BASE_SETTINGS, override);
    expect(eff.minUpsidePct).toBe(0);
  });

  it('delta range is shifted by strategy mode', () => {
    const income: StrategySettings = { ...BASE_SETTINGS, strategyMode: 'incomeFocused' };
    const eff = effectiveSettings(income, undefined);
    // incomeFocused shifts [0.15, 0.35] by [+0.05, +0.05] → [0.20, 0.40]
    expect(eff.targetDeltaRange[0]).toBeCloseTo(0.20, 6);
    expect(eff.targetDeltaRange[1]).toBeCloseTo(0.40, 6);
  });

  it('upsideFocused shifts delta range down', () => {
    const upside: StrategySettings = { ...BASE_SETTINGS, strategyMode: 'upsideFocused' };
    const eff = effectiveSettings(upside, undefined);
    expect(eff.targetDeltaRange[0]).toBeCloseTo(0.10, 6);
    expect(eff.targetDeltaRange[1]).toBeCloseTo(0.30, 6);
  });

  it('delta range is clamped to [0.01, 0.99]', () => {
    const settings: StrategySettings = {
      ...BASE_SETTINGS,
      strategyMode: 'upsideFocused',
      targetDeltaRange: [0.01, 0.10],
    };
    const eff = effectiveSettings(settings, undefined);
    expect(eff.targetDeltaRange[0]).toBeGreaterThanOrEqual(0.01);
  });

  it('roll settings merge partially', () => {
    const override: TickerOverride = {
      symbol: 'X',
      roll: { deltaThreshold: 0.7 },
    };
    const eff = effectiveSettings(BASE_SETTINGS, override);
    expect(eff.roll.deltaThreshold).toBe(0.7);
    expect(eff.roll.nearStrikePct).toBe(0.02); // not overridden
  });

  it('all 9 mode × preference combinations produce valid results', () => {
    const modes = ['incomeFocused', 'balanced', 'upsideFocused'] as const;
    const prefs = ['avoid', 'neutral', 'prefer'] as const;
    for (const mode of modes) {
      for (const pref of prefs) {
        const settings: StrategySettings = { ...BASE_SETTINGS, strategyMode: mode };
        const override: TickerOverride = { symbol: 'X', assignmentPreference: pref };
        const eff = effectiveSettings(settings, override);
        expect(eff.targetDeltaRange[0]).toBeGreaterThanOrEqual(0.01);
        expect(eff.targetDeltaRange[1]).toBeLessThanOrEqual(0.99);
        expect(eff.targetDeltaRange[0]).toBeLessThanOrEqual(eff.targetDeltaRange[1]);
        expect(eff.assignmentPreference).toBe(pref);
      }
    }
  });
});
