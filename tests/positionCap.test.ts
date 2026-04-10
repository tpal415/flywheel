import { describe, it, expect } from 'vitest';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import { generateChain } from '../src/fixtures/generateChain.js';
import type { Portfolio } from '../src/types/positions.js';
import type { StrategySettings, TickerOverride } from '../src/types/settings.js';

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

function makePortfolio(shares: number): Portfolio {
  return {
    cash: 0,
    stocks: [{ id: 's', symbol: 'TEST', shares, avgCostBasis: 90, currentPrice: 100 }],
    options: [],
    closedTrades: [],
    watchlist: [],
  };
}

describe('maxContractsPerTicker', () => {
  it('0 means no limit — all available contracts shown', () => {
    const chain = generateChain({ symbol: 'TEST', spot: 100, ivAnnual: 0.5, expirations: EXPS });
    const recs = generateCoveredCallRecommendations(
      makePortfolio(1000), // 10 contracts
      new Map([['TEST', chain]]),
      { ...SETTINGS, maxContractsPerTicker: 0 },
      [],
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(10);
    expect(recs[0]!.positionCapped).toBe(false);
  });

  it('global cap limits contracts and sets positionCapped', () => {
    const chain = generateChain({ symbol: 'TEST', spot: 100, ivAnnual: 0.5, expirations: EXPS });
    const recs = generateCoveredCallRecommendations(
      makePortfolio(1000),
      new Map([['TEST', chain]]),
      { ...SETTINGS, maxContractsPerTicker: 3 },
      [],
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(3);
    expect(recs[0]!.positionCapped).toBe(true);
    expect(recs[0]!.totalPremium).toBeCloseTo(recs[0]!.premium * 3, 4);
  });

  it('per-ticker override cap overrides global', () => {
    const chain = generateChain({ symbol: 'TEST', spot: 100, ivAnnual: 0.5, expirations: EXPS });
    const override: TickerOverride = { symbol: 'TEST', maxContractsPerTicker: 2 };
    const recs = generateCoveredCallRecommendations(
      makePortfolio(500), // 5 contracts available
      new Map([['TEST', chain]]),
      { ...SETTINGS, maxContractsPerTicker: 10 }, // global cap 10
      [override],
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(2); // per-ticker cap wins
    expect(recs[0]!.positionCapped).toBe(true);
  });

  it('cap at or above available does not trigger positionCapped', () => {
    const chain = generateChain({ symbol: 'TEST', spot: 100, ivAnnual: 0.5, expirations: EXPS });
    const recs = generateCoveredCallRecommendations(
      makePortfolio(200), // 2 contracts
      new Map([['TEST', chain]]),
      { ...SETTINGS, maxContractsPerTicker: 5 }, // cap 5, but only 2 available
      [],
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.contractsAvailable).toBe(2);
    expect(recs[0]!.positionCapped).toBe(false);
  });
});

describe('liquidity warnings', () => {
  it('all recs have a warnings array', () => {
    const chain = generateChain({ symbol: 'TEST', spot: 100, ivAnnual: 0.5, expirations: EXPS });
    const recs = generateCoveredCallRecommendations(
      makePortfolio(200),
      new Map([['TEST', chain]]),
      SETTINGS,
      [],
    );
    for (const r of recs) {
      expect(Array.isArray(r.warnings)).toBe(true);
    }
  });
});
