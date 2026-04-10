import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config/loader.js';

/** Minimal valid config shapes for testing. */
const VALID_HOLDINGS = {
  cash: 10000,
  stocks: [{ symbol: 'TSLA', shares: 100, avgCostBasis: 200 }],
  openOptions: [] as {
    symbol: string; type: 'CALL' | 'PUT'; strike: number;
    expiration: string; contracts: number; openPrice: number;
    side: 'SHORT' | 'LONG'; originalDte: number; openedOn: string;
  }[],
  closedTrades: [] as {
    symbol: string; type: 'CALL' | 'PUT'; contracts: number;
    netPremium: number; closedOn: string;
  }[],
};

const VALID_MARKET = {
  evaluationDate: '2026-04-08',
  expirations: [{ date: '2026-04-15', dte: 7 }],
  tickers: { TSLA: { price: 240, iv: 0.55 } } as Record<string, { price: number; iv: number }>,
  chainAssumptions: { riskFreeRate: 0.045, dividendYield: 0 },
};

const VALID_SETTINGS = {
  strategyMode: 'balanced',
  targetDeltaRange: [0.15, 0.35] as [number, number],
  minDTE: 5, maxDTE: 50,
  minPremiumPct: 0.003, minAnnualizedYield: 0.10,
  roll: {
    deltaThreshold: 0.5, dteRatioThreshold: 0.3,
    nearStrikePct: 0.02, minDte: 3, profitCapturePct: 0.8,
  },
};

const VALID_OVERRIDES: { symbol: string }[] = [];

describe('validateConfig — valid inputs', () => {
  it('returns empty array for valid config', () => {
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, VALID_SETTINGS, VALID_OVERRIDES, false);
    expect(errors).toEqual([]);
  });
});

describe('validateConfig — holdings errors', () => {
  it('catches negative cash', () => {
    const h = { ...VALID_HOLDINGS, cash: -1 };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('cash'))).toBe(true);
  });

  it('catches empty stock symbol', () => {
    const h = { ...VALID_HOLDINGS, stocks: [{ symbol: '', shares: 100, avgCostBasis: 200 }] };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('empty symbol'))).toBe(true);
  });

  it('catches zero shares', () => {
    const h = { ...VALID_HOLDINGS, stocks: [{ symbol: 'TSLA', shares: 0, avgCostBasis: 200 }] };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('shares'))).toBe(true);
  });

  it('catches zero cost basis', () => {
    const h = { ...VALID_HOLDINGS, stocks: [{ symbol: 'TSLA', shares: 100, avgCostBasis: 0 }] };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('avgCostBasis'))).toBe(true);
  });

  it('catches invalid open option fields', () => {
    const h = {
      ...VALID_HOLDINGS,
      openOptions: [{
        symbol: 'TSLA', type: 'INVALID' as 'CALL', strike: -5,
        expiration: 'bad', contracts: 0, openPrice: -1,
        side: 'INVALID' as 'SHORT', originalDte: 0, openedOn: 'bad',
      }],
    };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.some((e) => e.includes('type'))).toBe(true);
    expect(errors.some((e) => e.includes('side'))).toBe(true);
    expect(errors.some((e) => e.includes('strike'))).toBe(true);
    expect(errors.some((e) => e.includes('contracts'))).toBe(true);
    expect(errors.some((e) => e.includes('originalDte'))).toBe(true);
  });

  it('catches invalid closed trade fields', () => {
    const h = {
      ...VALID_HOLDINGS,
      closedTrades: [{
        symbol: '', type: 'BAD' as 'CALL', contracts: -1,
        netPremium: NaN, closedOn: 'nope',
      }],
    };
    const errors = validateConfig(h, VALID_MARKET, VALID_SETTINGS, [], false);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('validateConfig — market errors', () => {
  it('catches invalid evaluationDate', () => {
    const m = { ...VALID_MARKET, evaluationDate: 'not-a-date' };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('evaluationDate'))).toBe(true);
  });

  it('catches empty expirations', () => {
    const m = { ...VALID_MARKET, expirations: [] };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('expiration'))).toBe(true);
  });

  it('catches zero DTE', () => {
    const m = { ...VALID_MARKET, expirations: [{ date: '2026-04-08', dte: 0 }] };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('DTE'))).toBe(true);
  });

  it('catches missing price for a holding', () => {
    const m = { ...VALID_MARKET, tickers: {} };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('missing price'))).toBe(true);
  });

  it('catches zero price', () => {
    const m = { ...VALID_MARKET, tickers: { TSLA: { price: 0, iv: 0.5 } } };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('price must be positive'))).toBe(true);
  });

  it('catches IV out of range', () => {
    const m = { ...VALID_MARKET, tickers: { TSLA: { price: 240, iv: 6 } } };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], false);
    expect(errors.some((e) => e.includes('IV'))).toBe(true);
  });

  it('skips ticker validation when skipMarketTickers is true', () => {
    const m = { ...VALID_MARKET, tickers: {} };
    const errors = validateConfig(VALID_HOLDINGS, m, VALID_SETTINGS, [], true);
    expect(errors.some((e) => e.includes('missing price'))).toBe(false);
  });
});

describe('validateConfig — settings errors', () => {
  it('catches invalid strategyMode', () => {
    const s = { ...VALID_SETTINGS, strategyMode: 'yolo' };
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, s, [], false);
    expect(errors.some((e) => e.includes('strategyMode'))).toBe(true);
  });

  it('catches inverted delta range', () => {
    const s = { ...VALID_SETTINGS, targetDeltaRange: [0.5, 0.1] as [number, number] };
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, s, [], false);
    expect(errors.some((e) => e.includes('targetDeltaRange'))).toBe(true);
  });

  it('catches maxDTE < minDTE', () => {
    const s = { ...VALID_SETTINGS, minDTE: 30, maxDTE: 10 };
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, s, [], false);
    expect(errors.some((e) => e.includes('maxDTE'))).toBe(true);
  });

  it('catches invalid roll settings', () => {
    const s = {
      ...VALID_SETTINGS,
      roll: { ...VALID_SETTINGS.roll, deltaThreshold: 1.5, profitCapturePct: -1 },
    };
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, s, [], false);
    expect(errors.some((e) => e.includes('deltaThreshold'))).toBe(true);
    expect(errors.some((e) => e.includes('profitCapturePct'))).toBe(true);
  });
});

describe('validateConfig — override errors', () => {
  it('catches empty symbol in override', () => {
    const errors = validateConfig(VALID_HOLDINGS, VALID_MARKET, VALID_SETTINGS, [{ symbol: '' }], false);
    expect(errors.some((e) => e.includes('empty symbol'))).toBe(true);
  });

  it('catches invalid assignmentPreference', () => {
    const errors = validateConfig(
      VALID_HOLDINGS, VALID_MARKET, VALID_SETTINGS,
      [{ symbol: 'TSLA', assignmentPreference: 'yolo' }], false,
    );
    expect(errors.some((e) => e.includes('assignmentPreference'))).toBe(true);
  });

  it('catches invalid override delta range', () => {
    const errors = validateConfig(
      VALID_HOLDINGS, VALID_MARKET, VALID_SETTINGS,
      [{ symbol: 'TSLA', targetDeltaRange: [0.5, 0.1] as [number, number] }], false,
    );
    expect(errors.some((e) => e.includes('targetDeltaRange'))).toBe(true);
  });
});
