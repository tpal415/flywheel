/**
 * Deterministic demo portfolio and option-chain fixtures.
 *
 * No randomness, no dates parsed at runtime. The evaluation date is
 * fixed at 2026-04-08 for reproducibility; expirations are chosen
 * relative to that date to hit roughly 7, 21, and 45 DTE.
 */

import type { OptionChain } from '../types/chains.js';
import type {
  ClosedTrade,
  OptionPosition,
  Portfolio,
  StockPosition,
} from '../types/positions.js';
import type {
  StrategySettings,
  TickerOverride,
} from '../types/settings.js';
import { generateChain } from './generateChain.js';

/** Fixed evaluation date so everything is deterministic. */
export const EVAL_DATE = '2026-04-08';

/** Expirations measured in DTE from EVAL_DATE. */
export const DEMO_EXPIRATIONS = [
  { date: '2026-04-15', dte: 7 },
  { date: '2026-04-29', dte: 21 },
  { date: '2026-05-23', dte: 45 },
] as const;

const STOCKS: readonly StockPosition[] = [
  {
    id: 'stk-tsla',
    symbol: 'TSLA',
    shares: 200,
    avgCostBasis: 220,
    currentPrice: 240,
  },
  {
    id: 'stk-pltr',
    symbol: 'PLTR',
    shares: 200,
    avgCostBasis: 18,
    currentPrice: 22,
  },
  {
    id: 'stk-iren',
    symbol: 'IREN',
    shares: 400,
    avgCostBasis: 9,
    currentPrice: 11,
  },
  {
    id: 'stk-open',
    symbol: 'OPEN',
    shares: 14_400,
    avgCostBasis: 3.5,
    currentPrice: 4,
  },
  {
    id: 'stk-msft',
    symbol: 'MSFT',
    shares: 100,
    avgCostBasis: 380,
    currentPrice: 420,
  },
];

/**
 * One open short CALL that is ITM and close to expiry — used to demo the
 * roll engine. TSLA spot is 240, this short 225 call originally had
 * 30 DTE and now has 7 DTE → both triggers fire.
 */
const OPEN_OPTIONS: readonly OptionPosition[] = [
  {
    id: 'opt-tsla-cc-225-04-15',
    symbol: 'TSLA',
    type: 'CALL',
    strike: 225,
    expiration: '2026-04-15',
    contracts: 1,
    openPrice: 4.2,
    side: 'SHORT',
    originalDte: 30,
    openedOn: '2026-03-09',
  },
];

const CLOSED_TRADES: readonly ClosedTrade[] = [
  {
    id: 'ct-1',
    symbol: 'PLTR',
    type: 'CALL',
    contracts: 2,
    netPremium: 180,
    closedOn: '2026-02-20',
  },
  {
    id: 'ct-2',
    symbol: 'IREN',
    type: 'CALL',
    contracts: 4,
    netPremium: 260,
    closedOn: '2026-03-01',
  },
  {
    id: 'ct-3',
    symbol: 'OPEN',
    type: 'CALL',
    contracts: 20,
    netPremium: 640,
    closedOn: '2026-03-14',
  },
  {
    id: 'ct-4',
    symbol: 'MSFT',
    type: 'PUT',
    contracts: 1,
    netPremium: 320,
    closedOn: '2026-03-21',
  },
];

export const DEMO_PORTFOLIO: Portfolio = {
  cash: 25_000,
  stocks: STOCKS,
  options: OPEN_OPTIONS,
  closedTrades: CLOSED_TRADES,
  watchlist: ['NVDA', 'AMD', 'GOOGL'],
};

/** Per-symbol parameters for the synthetic chain generator. */
interface ChainSpec {
  readonly symbol: string;
  readonly spot: number;
  readonly iv: number;
}

const CHAIN_SPECS: readonly ChainSpec[] = [
  { symbol: 'TSLA', spot: 240, iv: 0.55 },
  { symbol: 'PLTR', spot: 22, iv: 0.6 },
  { symbol: 'IREN', spot: 11, iv: 0.75 },
  { symbol: 'OPEN', spot: 4, iv: 0.8 },
  { symbol: 'MSFT', spot: 420, iv: 0.22 },
  // Watchlist symbols
  { symbol: 'NVDA', spot: 900, iv: 0.45 },
  { symbol: 'AMD', spot: 180, iv: 0.5 },
  { symbol: 'GOOGL', spot: 160, iv: 0.28 },
];

/**
 * Build the map of symbol → chain used by all engine calls.
 * Generated deterministically every call — no caching.
 */
export function buildDemoChains(): ReadonlyMap<string, OptionChain> {
  const map = new Map<string, OptionChain>();
  for (const spec of CHAIN_SPECS) {
    const chain = generateChain({
      symbol: spec.symbol,
      spot: spec.spot,
      ivAnnual: spec.iv,
      expirations: DEMO_EXPIRATIONS.map((e) => ({ date: e.date, dte: e.dte })),
    });
    map.set(spec.symbol, chain);
  }
  return map;
}

export const DEMO_SETTINGS: StrategySettings = {
  targetDeltaRange: [0.15, 0.35],
  minDTE: 5,
  maxDTE: 50,
  minPremiumPct: 0.003,
  minAnnualizedYield: 0.15,
  rollTriggerDelta: 0.5,
  rollTriggerDtePct: 0.3,
  maxRecommendationsPerSymbol: 3,
};

export const DEMO_OVERRIDES: readonly TickerOverride[] = [
  // TSLA: tighter delta band to keep assignment risk lower on a volatile name.
  {
    symbol: 'TSLA',
    targetDeltaRange: [0.15, 0.25],
  },
  // OPEN: accept lower absolute premium % since the underlying is cheap.
  {
    symbol: 'OPEN',
    minPremiumPct: 0.002,
    minAnnualizedYield: 0.1,
  },
];
