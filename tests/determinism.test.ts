import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import { generateCashSecuredPutRecommendations } from '../src/engine/cashSecuredPuts.js';
import { generateRollRecommendations } from '../src/engine/rolls.js';
import { loadConfig } from '../src/config/loader.js';
import {
  effectiveSettings,
  strategyModeDeltaShift,
  strategyModeDteMultiplier,
} from '../src/types/settings.js';

/**
 * Determinism tests — same inputs must always produce the same outputs.
 */

describe('engine determinism', () => {
  it('CC recs are identical across 3 runs', () => {
    const results = Array.from({ length: 3 }, () => {
      const cfg = loadConfig();
      return generateCoveredCallRecommendations(
        cfg.portfolio, cfg.chains, cfg.settings, cfg.overrides,
      );
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('CSP recs are identical across 3 runs', () => {
    const results = Array.from({ length: 3 }, () => {
      const cfg = loadConfig();
      return generateCashSecuredPutRecommendations(
        cfg.portfolio.watchlist, cfg.portfolio.cash,
        cfg.chains, cfg.settings, cfg.overrides,
      );
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it('roll recs are identical across 3 runs', () => {
    const results = Array.from({ length: 3 }, () => {
      const cfg = loadConfig();
      return generateRollRecommendations(
        cfg.portfolio.options, cfg.chains, cfg.settings, cfg.overrides,
      );
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});

describe('settings helpers determinism', () => {
  it('strategyModeDeltaShift returns consistent values', () => {
    expect(strategyModeDeltaShift('incomeFocused')).toEqual([0.05, 0.05]);
    expect(strategyModeDeltaShift('balanced')).toEqual([0, 0]);
    expect(strategyModeDeltaShift('upsideFocused')).toEqual([-0.05, -0.05]);
  });

  it('strategyModeDteMultiplier returns consistent values', () => {
    expect(strategyModeDteMultiplier('incomeFocused')).toBe(0.8);
    expect(strategyModeDteMultiplier('balanced')).toBe(1.0);
    expect(strategyModeDteMultiplier('upsideFocused')).toBe(1.2);
  });

  it('effectiveSettings merges correctly', () => {
    const cfg = loadConfig();
    const eff = effectiveSettings(cfg.settings, {
      symbol: 'TSLA',
      assignmentPreference: 'avoid',
      compounder: true,
      minUpsidePct: 0.08,
      targetDeltaRange: [0.10, 0.20],
    });
    expect(eff.assignmentPreference).toBe('avoid');
    expect(eff.compounder).toBe(true);
    expect(eff.minUpsidePct).toBe(0.08);
    // Delta range should be base [0.10, 0.20] shifted by balanced mode [0, 0].
    expect(eff.targetDeltaRange[0]).toBeCloseTo(0.10, 6);
    expect(eff.targetDeltaRange[1]).toBeCloseTo(0.20, 6);
    // Other settings fall through from global.
    expect(eff.minDTE).toBe(cfg.settings.minDTE);
  });

  it('effectiveSettings defaults for neutral with no override', () => {
    const cfg = loadConfig();
    const eff = effectiveSettings(cfg.settings, undefined);
    expect(eff.assignmentPreference).toBe('neutral');
    expect(eff.compounder).toBe(false);
    expect(eff.minUpsidePct).toBe(0);
  });

  it('"avoid" default minUpsidePct is 5%', () => {
    const cfg = loadConfig();
    const eff = effectiveSettings(cfg.settings, {
      symbol: 'TEST',
      assignmentPreference: 'avoid',
    });
    expect(eff.minUpsidePct).toBe(0.05);
  });
});

describe('CLI output snapshot determinism', () => {
  it('two consecutive CLI runs produce identical output (ignoring timestamps)', () => {
    const strip = (s: string) =>
      s
        .replace(/@ \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '@ TIMESTAMP')
        .replace(/\x1B\[[0-9;]*m/g, '');

    const run1 = execSync('npx tsx src/cli/index.ts 2>/dev/null', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    const run2 = execSync('npx tsx src/cli/index.ts 2>/dev/null', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
    expect(strip(run2)).toBe(strip(run1));
  });
});
