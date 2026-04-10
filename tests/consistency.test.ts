import { describe, it, expect } from 'vitest';
import { generateCoveredCallRecommendations } from '../src/engine/coveredCalls.js';
import { generateCashSecuredPutRecommendations } from '../src/engine/cashSecuredPuts.js';
import { annualizedYield } from '../src/engine/scoring.js';
import {
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  DEMO_OVERRIDES,
  buildDemoChains,
} from '../src/fixtures/index.js';

/**
 * Output consistency tests — verify that the numbers in recommendations
 * are internally consistent. If any of these fail, the CLI output is lying.
 */

describe('CC recommendation math consistency', () => {
  const chains = buildDemoChains();
  const recs = generateCoveredCallRecommendations(
    DEMO_PORTFOLIO, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
  );

  it('premium = mid * 100', () => {
    for (const r of recs) {
      expect(r.premium).toBeCloseTo(r.contract.mid * 100, 4);
    }
  });

  it('totalPremium = premium * contractsAvailable', () => {
    for (const r of recs) {
      expect(r.totalPremium).toBeCloseTo(r.premium * r.contractsAvailable, 4);
    }
  });

  it('cycleYield = premium / (currentPrice * 100)', () => {
    for (const r of recs) {
      const expected = r.premium / (r.currentPrice * 100);
      expect(r.cycleYield).toBeCloseTo(expected, 6);
    }
  });

  it('annualizedYield = cycleYield * (365 / dte)', () => {
    for (const r of recs) {
      const expected = r.cycleYield * (365 / r.contract.dte);
      expect(r.annualizedYield).toBeCloseTo(expected, 4);
    }
  });

  it('annualizedYield matches annualizedYield() helper', () => {
    for (const r of recs) {
      const notional = r.currentPrice * 100;
      const expected = annualizedYield(r.premium, notional, r.contract.dte);
      expect(r.annualizedYield).toBeCloseTo(expected, 6);
    }
  });

  it('upsidePct = (strike - currentPrice) / currentPrice', () => {
    for (const r of recs) {
      const expected = (r.contract.strike - r.currentPrice) / r.currentPrice;
      expect(r.upsidePct).toBeCloseTo(expected, 6);
    }
  });

  it('assignmentProb = |delta|', () => {
    for (const r of recs) {
      expect(r.assignmentProb).toBeCloseTo(Math.abs(r.contract.delta), 6);
    }
  });

  it('strike is always > currentPrice (OTM only)', () => {
    for (const r of recs) {
      expect(r.contract.strike).toBeGreaterThan(r.currentPrice);
    }
  });

  it('contractsAvailable is correct based on shares / 100 (respecting position cap)', () => {
    for (const r of recs) {
      const stock = DEMO_PORTFOLIO.stocks.find((s) => s.symbol === r.symbol);
      expect(stock).toBeDefined();
      const covered = DEMO_PORTFOLIO.options
        .filter(
          (o) =>
            o.symbol === r.symbol &&
            o.type === 'CALL' &&
            o.side === 'SHORT',
        )
        .reduce((sum, o) => sum + o.contracts * 100, 0);
      const uncovered = stock!.shares - covered;
      const rawContracts = Math.floor(uncovered / 100);
      // contractsAvailable may be capped by maxContractsPerTicker.
      expect(r.contractsAvailable).toBeLessThanOrEqual(rawContracts);
      expect(r.contractsAvailable).toBeGreaterThan(0);
      if (r.positionCapped) {
        expect(r.contractsAvailable).toBeLessThan(rawContracts);
      }
    }
  });
});

describe('CSP recommendation math consistency', () => {
  const chains = buildDemoChains();
  const recs = generateCashSecuredPutRecommendations(
    DEMO_PORTFOLIO.watchlist, DEMO_PORTFOLIO.cash, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
  );

  it('premium = mid * 100', () => {
    for (const r of recs) {
      expect(r.premium).toBeCloseTo(r.contract.mid * 100, 4);
    }
  });

  it('cashRequired = strike * 100', () => {
    for (const r of recs) {
      expect(r.cashRequired).toBeCloseTo(r.contract.strike * 100, 4);
    }
  });

  it('cycleYield = premium / cashRequired', () => {
    for (const r of recs) {
      const expected = r.premium / r.cashRequired;
      expect(r.cycleYield).toBeCloseTo(expected, 6);
    }
  });

  it('annualizedYield = cycleYield * (365 / dte)', () => {
    for (const r of recs) {
      const expected = r.cycleYield * (365 / r.contract.dte);
      expect(r.annualizedYield).toBeCloseTo(expected, 4);
    }
  });

  it('cashRequired <= cashAvailable', () => {
    for (const r of recs) {
      expect(r.cashRequired).toBeLessThanOrEqual(DEMO_PORTFOLIO.cash);
    }
  });

  it('contractsAvailable = floor(cash / cashRequired)', () => {
    for (const r of recs) {
      const expected = Math.floor(DEMO_PORTFOLIO.cash / r.cashRequired);
      expect(r.contractsAvailable).toBe(expected);
    }
  });

  it('upsidePct = (spot - strike) / spot for puts', () => {
    for (const r of recs) {
      const expected = (r.currentPrice - r.contract.strike) / r.currentPrice;
      expect(r.upsidePct).toBeCloseTo(expected, 6);
    }
  });

  it('strike < currentPrice (OTM puts only)', () => {
    for (const r of recs) {
      expect(r.contract.strike).toBeLessThan(r.currentPrice);
    }
  });
});

describe('score is bounded [0, 1]', () => {
  it('CC scores are in [0, 1]', () => {
    const chains = buildDemoChains();
    const recs = generateCoveredCallRecommendations(
      DEMO_PORTFOLIO, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    for (const r of recs) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('CSP scores are in [0, 1]', () => {
    const chains = buildDemoChains();
    const recs = generateCashSecuredPutRecommendations(
      DEMO_PORTFOLIO.watchlist, DEMO_PORTFOLIO.cash, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    for (const r of recs) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
