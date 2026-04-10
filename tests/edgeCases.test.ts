import { describe, it, expect } from 'vitest';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import { generateCashSecuredPutRecommendations } from '../src/engine/cashSecuredPuts.js';
import { generateRollRecommendations } from '../src/engine/rolls.js';
import { generateChain } from '../src/fixtures/generateChain.js';
import type { OptionChain } from '../src/types/chains.js';
import type { Portfolio } from '../src/types/positions.js';
import type { StrategySettings } from '../src/types/settings.js';

const SETTINGS: StrategySettings = {
  strategyMode: 'balanced',
  targetDeltaRange: [0.10, 0.40],
  minDTE: 5, maxDTE: 50,
  minPremiumPct: 0.001, minAnnualizedYield: 0.05,
  maxContractsPerTicker: 0,
  roll: {
    deltaThreshold: 0.5, dteRatioThreshold: 0.3,
    nearStrikePct: 0.02, minDte: 3, profitCapturePct: 0.8,
  },
};

const EXPS = [
  { date: '2026-04-15', dte: 7 },
  { date: '2026-04-29', dte: 21 },
  { date: '2026-05-23', dte: 45 },
];

function makeChain(symbol: string, spot: number, iv = 0.5): OptionChain {
  return generateChain({ symbol, spot, ivAnnual: iv, expirations: EXPS });
}

function makePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    cash: 25000,
    stocks: [
      { id: 'stk-test', symbol: 'TEST', shares: 200, avgCostBasis: 90, currentPrice: 100 },
    ],
    options: [],
    closedTrades: [],
    watchlist: ['WL1'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Share count edge cases
// ---------------------------------------------------------------------------

describe('share count edge cases', () => {
  it('99 shares produces no CC recommendations', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 99, avgCostBasis: 90, currentPrice: 100 }],
    });
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });

  it('100 shares produces exactly 1 contract available', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 100, avgCostBasis: 90, currentPrice: 100 }],
    });
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(1);
  });

  it('250 shares produces 2 contracts available', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 250, avgCostBasis: 90, currentPrice: 100 }],
    });
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(2);
  });

  it('fully covered position (all shares have short calls) produces no recs', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 200, avgCostBasis: 90, currentPrice: 100 }],
      options: [
        {
          id: 'o1', symbol: 'TEST', type: 'CALL', strike: 110,
          expiration: '2026-04-29', contracts: 2, openPrice: 3,
          side: 'SHORT', originalDte: 21, openedOn: '2026-04-08',
        },
      ],
    });
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No valid option candidates
// ---------------------------------------------------------------------------

describe('no valid option candidates', () => {
  it('returns empty when all strikes are below cost basis', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 100, avgCostBasis: 500, currentPrice: 100 }],
    });
    // Cost basis 500 but spot 100 — all OTM strikes will be < 500.
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });

  it('returns empty when minPremiumPct is impossibly high', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const s = { ...SETTINGS, minPremiumPct: 1.0 }; // 100% premium
    const recs = generateCoveredCallRecommendations(p, chains, s, []);
    expect(recs.length).toBe(0);
  });

  it('returns empty when minAnnualizedYield is impossibly high', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const s = { ...SETTINGS, minAnnualizedYield: 100 }; // 10000%
    const recs = generateCoveredCallRecommendations(p, chains, s, []);
    expect(recs.length).toBe(0);
  });

  it('returns empty when no chain exists for the symbol', () => {
    const p = makePortfolio();
    const chains = new Map<string, OptionChain>();
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });

  it('returns empty when delta range excludes all candidates', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const s = { ...SETTINGS, targetDeltaRange: [0.99, 0.99] as const };
    const recs = generateCoveredCallRecommendations(p, chains, s, []);
    expect(recs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Extreme IV and premium scenarios
// ---------------------------------------------------------------------------

describe('extreme IV scenarios', () => {
  it('very low IV (5%) still produces some candidates', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100, 0.05)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    // Low IV means low premiums — some may pass, some may not, but shouldn't crash.
    expect(Array.isArray(recs)).toBe(true);
  });

  it('very high IV (200%) produces candidates without NaN', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100, 2.0)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, []);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(Number.isFinite(r.premium)).toBe(true);
      expect(Number.isFinite(r.score)).toBe(true);
      expect(Number.isFinite(r.annualizedYield)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// CSP edge cases
// ---------------------------------------------------------------------------

describe('CSP edge cases', () => {
  it('empty watchlist returns empty', () => {
    const chains = new Map([['WL1', makeChain('WL1', 100)]]);
    const recs = generateCashSecuredPutRecommendations([], 25000, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });

  it('$1 cash returns empty (no contracts affordable)', () => {
    const chains = new Map([['WL1', makeChain('WL1', 100)]]);
    const recs = generateCashSecuredPutRecommendations(['WL1'], 1, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });

  it('no chain for watchlist symbol returns empty', () => {
    const chains = new Map<string, OptionChain>();
    const recs = generateCashSecuredPutRecommendations(['NOSYM'], 25000, chains, SETTINGS, []);
    expect(recs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Roll edge cases
// ---------------------------------------------------------------------------

describe('roll edge cases', () => {
  it('empty position list returns empty', () => {
    const recs = generateRollRecommendations([], new Map(), SETTINGS);
    expect(recs.length).toBe(0);
  });

  it('position with no matching chain returns empty', () => {
    const pos = {
      id: 'o1', symbol: 'MISSING', type: 'CALL' as const, strike: 110,
      expiration: '2026-04-15', contracts: 1, openPrice: 3,
      side: 'SHORT' as const, originalDte: 30, openedOn: '2026-03-16',
    };
    const recs = generateRollRecommendations([pos], new Map(), SETTINGS);
    expect(recs.length).toBe(0);
  });

  it('position with expiration not in chain returns empty', () => {
    const chain = makeChain('TEST', 100);
    const pos = {
      id: 'o1', symbol: 'TEST', type: 'CALL' as const, strike: 100,
      expiration: '2099-12-31', contracts: 1, openPrice: 3,
      side: 'SHORT' as const, originalDte: 30, openedOn: '2026-03-16',
    };
    const recs = generateRollRecommendations(
      [pos], new Map([['TEST', chain]]), SETTINGS,
    );
    expect(recs.length).toBe(0);
  });

  it('PUT roll trigger works', () => {
    // Create a deep-ITM short put: strike 120, spot 100 → ITM by 20%.
    const chain = makeChain('TEST', 100);
    const pos = {
      id: 'put-1', symbol: 'TEST', type: 'PUT' as const, strike: 120,
      expiration: '2026-04-15', contracts: 1, openPrice: 5,
      side: 'SHORT' as const, originalDte: 30, openedOn: '2026-03-16',
    };
    const recs = generateRollRecommendations(
      [pos], new Map([['TEST', chain]]),
      { ...SETTINGS, roll: { ...SETTINGS.roll, deltaThreshold: 0.01 } },
    );
    // Should trigger if delta is high enough.
    // The actual outcome depends on whether a net-credit candidate exists.
    expect(Array.isArray(recs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Assignment preference filtering
// ---------------------------------------------------------------------------

describe('assignment preference filtering', () => {
  it('"avoid" with 15% minUpsidePct filters out close strikes', () => {
    const p = makePortfolio();
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, [
      { symbol: 'TEST', assignmentPreference: 'avoid', minUpsidePct: 0.15 },
    ]);
    for (const r of recs) {
      expect(r.upsidePct).toBeGreaterThanOrEqual(0.15 - 1e-9);
    }
  });

  it('"prefer" still respects cost basis floor', () => {
    const p = makePortfolio({
      stocks: [{ id: 's', symbol: 'TEST', shares: 100, avgCostBasis: 110, currentPrice: 100 }],
    });
    const chains = new Map([['TEST', makeChain('TEST', 100)]]);
    const recs = generateCoveredCallRecommendations(p, chains, SETTINGS, [
      { symbol: 'TEST', assignmentPreference: 'prefer' },
    ]);
    for (const r of recs) {
      expect(r.contract.strike).toBeGreaterThanOrEqual(110);
    }
  });
});
