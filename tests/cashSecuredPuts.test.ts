import { describe, it, expect } from 'vitest';
import { generateCashSecuredPutRecommendations } from '../src/engine/cashSecuredPuts.js';
import {
  DEMO_OVERRIDES,
  DEMO_SETTINGS,
  buildDemoChains,
} from '../src/fixtures/index.js';

describe('generateCashSecuredPutRecommendations', () => {
  it('excludes candidates exceeding cashAvailable', () => {
    const chains = buildDemoChains();
    const recs = generateCashSecuredPutRecommendations(
      ['NVDA', 'AMD', 'GOOGL'], 25_000, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    expect(recs.filter((r) => r.symbol === 'NVDA').length).toBe(0);
    const others = recs.filter((r) => r.symbol !== 'NVDA');
    expect(others.length).toBeGreaterThan(0);
    for (const r of others) {
      expect(r.cashRequired).toBeLessThanOrEqual(25_000);
    }
  });

  it('zero cash produces no recs', () => {
    const recs = generateCashSecuredPutRecommendations(
      ['AMD', 'GOOGL', 'NVDA'], 0, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    expect(recs.length).toBe(0);
  });

  it('returns at most 2 recs per ticker', () => {
    const recs = generateCashSecuredPutRecommendations(
      ['AMD', 'GOOGL'], 25_000, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const counts = new Map<string, number>();
    for (const r of recs) counts.set(r.symbol, (counts.get(r.symbol) ?? 0) + 1);
    for (const [, count] of counts) expect(count).toBeLessThanOrEqual(2);
  });
});
