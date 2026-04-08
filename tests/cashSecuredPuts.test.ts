import { describe, it, expect } from 'vitest';
import { generateCashSecuredPutRecommendations } from '../src/engine/cashSecuredPuts.js';
import {
  DEMO_OVERRIDES,
  DEMO_SETTINGS,
  buildDemoChains,
} from '../src/fixtures/index.js';

describe('generateCashSecuredPutRecommendations', () => {
  it('excludes candidates that exceed cashAvailable', () => {
    const chains = buildDemoChains();
    // $25,000 cash: NVDA puts require ≥ $67,500 per contract and must all
    // be filtered out; AMD/GOOGL should still produce candidates.
    const recs = generateCashSecuredPutRecommendations(
      ['NVDA', 'AMD', 'GOOGL'],
      25_000,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    const nvda = recs.filter((r) => r.symbol === 'NVDA');
    expect(nvda.length).toBe(0);
    const others = recs.filter((r) => r.symbol !== 'NVDA');
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) {
      expect(r.cashRequired).toBeLessThanOrEqual(25_000);
    }
  });

  it('never returns ITM puts as acceptable entries', () => {
    const chains = buildDemoChains();
    const recs = generateCashSecuredPutRecommendations(
      ['AMD', 'GOOGL'],
      25_000,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    for (const r of recs) {
      const chain = chains.get(r.symbol);
      expect(chain).toBeDefined();
      expect(r.contract.strike).toBeLessThan(chain!.underlyingPrice);
    }
  });

  it('tightens cash requirement to zero eliminates all CSPs', () => {
    const chains = buildDemoChains();
    const recs = generateCashSecuredPutRecommendations(
      ['AMD', 'GOOGL', 'NVDA'],
      0,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    expect(recs.length).toBe(0);
  });
});
