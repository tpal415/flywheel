import { describe, it, expect } from 'vitest';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import {
  DEMO_OVERRIDES,
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  buildDemoChains,
} from '../src/fixtures/index.js';
import type { StrategySettings, TickerOverride } from '../src/types/settings.js';

describe('generateCoveredCallRecommendations', () => {
  it('never recommends a CC strike below cost basis', () => {
    const chains = buildDemoChains();
    const settings: StrategySettings = {
      ...DEMO_SETTINGS,
      // Widen delta and relax premium filters so every candidate that could
      // pass would be considered — the only thing stopping strikes < cost
      // basis from appearing is the cost-basis check itself.
      targetDeltaRange: [0.01, 0.99],
      minPremiumPct: 0,
      minAnnualizedYield: 0,
      minDTE: 1,
      maxDTE: 365,
      maxRecommendationsPerSymbol: 100,
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO,
      chains,
      settings,
      [],
    );
    expect(recs.length).toBeGreaterThan(0);
    const costBasisBySymbol = new Map<string, number>();
    for (const s of DEMO_PORTFOLIO.stocks) {
      costBasisBySymbol.set(s.symbol, s.avgCostBasis);
    }
    for (const r of recs) {
      const cb = costBasisBySymbol.get(r.symbol);
      expect(cb).toBeDefined();
      expect(r.contract.strike).toBeGreaterThanOrEqual(cb!);
    }
  });

  it('respects ticker overrides (TSLA tighter delta)', () => {
    const chains = buildDemoChains();
    const override: TickerOverride = {
      symbol: 'TSLA',
      targetDeltaRange: [0.15, 0.2],
    };
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO,
      chains,
      DEMO_SETTINGS,
      [override],
    );
    const tsla = recs.filter((r) => r.symbol === 'TSLA');
    expect(tsla.length).toBeGreaterThan(0);
    for (const r of tsla) {
      const d = Math.abs(r.contract.delta);
      expect(d).toBeGreaterThanOrEqual(0.15 - 1e-9);
      expect(d).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  it('is deterministic across repeated calls', () => {
    const a = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO,
      buildDemoChains(),
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    const b = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO,
      buildDemoChains(),
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    expect(b).toEqual(a);
  });

  it('skips positions that already have all shares covered', () => {
    const chains = buildDemoChains();
    const portfolio = {
      ...DEMO_PORTFOLIO,
      // MSFT has 100 shares → fully covered by 1 short call.
      options: [
        ...DEMO_PORTFOLIO.options,
        {
          id: 'opt-msft-cc',
          symbol: 'MSFT',
          type: 'CALL' as const,
          strike: 440,
          expiration: '2026-04-29',
          contracts: 1,
          openPrice: 5,
          side: 'SHORT' as const,
          originalDte: 21,
          openedOn: '2026-04-08',
        },
      ],
    };
    const recs = generateCoveredCallRecommendations(
      portfolio,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    expect(recs.find((r) => r.symbol === 'MSFT')).toBeUndefined();
  });
});
