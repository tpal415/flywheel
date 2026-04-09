import { describe, it, expect } from 'vitest';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import {
  DEMO_OVERRIDES,
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  buildDemoChains,
} from '../src/fixtures/index.js';
import type { TickerOverride } from '../src/types/settings.js';

describe('generateCoveredCallRecommendations', () => {
  it('never recommends a CC strike below cost basis', () => {
    const chains = buildDemoChains();
    const settings = {
      ...DEMO_SETTINGS,
      targetDeltaRange: [0.01, 0.99] as const,
      minPremiumPct: 0,
      minAnnualizedYield: 0,
      minDTE: 1,
      maxDTE: 365,
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, settings, [],
    );
    expect(recs.length).toBeGreaterThan(0);
    const cb = new Map(DEMO_PORTFOLIO.stocks.map((s) => [s.symbol, s.avgCostBasis]));
    for (const r of recs) {
      expect(r.contract.strike).toBeGreaterThanOrEqual(cb.get(r.symbol)!);
    }
  });

  it('respects ticker overrides (TSLA tighter delta)', () => {
    const chains = buildDemoChains();
    const override: TickerOverride = {
      symbol: 'TSLA',
      targetDeltaRange: [0.10, 0.15],
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, DEMO_SETTINGS, [override],
    );
    const tsla = recs.filter((r) => r.symbol === 'TSLA');
    for (const r of tsla) {
      const d = Math.abs(r.contract.delta);
      expect(d).toBeGreaterThanOrEqual(0.10 - 1e-4);
      expect(d).toBeLessThanOrEqual(0.15 + 1e-4);
    }
  });

  it('is deterministic', () => {
    const a = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const b = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    expect(b).toEqual(a);
  });

  it('returns at most 2 recs per ticker (primary + secondary)', () => {
    const chains = buildDemoChains();
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const counts = new Map<string, number>();
    for (const r of recs) {
      counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
    }
    for (const [, count] of counts) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('results grouped alphabetically by ticker', () => {
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const symbols = [...new Set(recs.map((r) => r.symbol))];
    expect(symbols).toEqual([...symbols].sort());
  });

  it('enforces minUpsidePct for "avoid" tickers', () => {
    const chains = buildDemoChains();
    const override: TickerOverride = {
      symbol: 'TSLA',
      assignmentPreference: 'avoid',
      minUpsidePct: 0.15, // 15% — very tight
      targetDeltaRange: [0.01, 0.99],
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, DEMO_SETTINGS, [override],
    );
    const tsla = recs.filter((r) => r.symbol === 'TSLA');
    for (const r of tsla) {
      expect(r.upsidePct).toBeGreaterThanOrEqual(0.15 - 1e-9);
    }
  });

  it('compounder flag appears in rationale', () => {
    const chains = buildDemoChains();
    const override: TickerOverride = {
      symbol: 'TSLA',
      compounder: true,
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, DEMO_SETTINGS, [override],
    );
    const tsla = recs.filter((r) => r.symbol === 'TSLA');
    if (tsla.length > 0) {
      expect(tsla[0]!.rationale.some((l) => l.includes('Compounder'))).toBe(true);
    }
  });
});
