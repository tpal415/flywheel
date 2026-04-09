/**
 * Config loader — reads editable JSON files from the config/ directory and
 * produces the runtime types the engine consumes.
 *
 * Files loaded:
 *   config/holdings.json  — cash, stocks (symbol, shares, costBasis),
 *                           open options, closed trades
 *   config/market.json    — evaluationDate, expirations, per-ticker price + IV,
 *                           chain-generation assumptions (risk-free rate, div yield)
 *   config/settings.json  — global strategy settings including roll thresholds
 *   config/overrides.json — per-ticker overrides (array)
 *   config/watchlist.json — CSP watchlist symbols
 *
 * The loader is intentionally straightforward: JSON.parse + type assertions.
 * No schema validation library — keep it dependency-free. Invalid data will
 * surface as runtime errors in the engine, which is fine for a personal tool.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OptionChain } from '../types/chains.js';
import type {
  ClosedTrade,
  OptionPosition,
  Portfolio,
  StockPosition,
} from '../types/positions.js';
import type {
  RollSettings,
  StrategySettings,
  TickerOverride,
} from '../types/settings.js';
import { generateChain } from '../fixtures/generateChain.js';

/** Resolve a path relative to the project root's config/ directory. */
function configPath(filename: string): string {
  // Walk up from src/config/ to project root.
  return join(import.meta.dirname, '..', '..', 'config', filename);
}

function readJson(filename: string): unknown {
  const raw = readFileSync(configPath(filename), 'utf-8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Raw JSON shapes (what's on disk)
// ---------------------------------------------------------------------------

interface RawHoldings {
  cash: number;
  stocks: {
    symbol: string;
    shares: number;
    avgCostBasis: number;
  }[];
  openOptions: {
    symbol: string;
    type: 'CALL' | 'PUT';
    strike: number;
    expiration: string;
    contracts: number;
    openPrice: number;
    side: 'SHORT' | 'LONG';
    originalDte: number;
    openedOn: string;
  }[];
  closedTrades: {
    symbol: string;
    type: 'CALL' | 'PUT';
    contracts: number;
    netPremium: number;
    closedOn: string;
  }[];
}

interface RawMarket {
  evaluationDate: string;
  expirations: { date: string; dte: number }[];
  tickers: Record<string, { price: number; iv: number }>;
  chainAssumptions: { riskFreeRate: number; dividendYield: number };
}

interface RawSettings {
  targetDeltaRange: [number, number];
  minDTE: number;
  maxDTE: number;
  minPremiumPct: number;
  minAnnualizedYield: number;
  maxRecommendationsPerSymbol: number;
  roll: {
    deltaThreshold: number;
    dteRatioThreshold: number;
    nearStrikePct: number;
    minDte: number;
    profitCapturePct: number;
  };
}

interface RawOverride {
  symbol: string;
  note?: string;
  targetDeltaRange?: [number, number];
  minDTE?: number;
  maxDTE?: number;
  minPremiumPct?: number;
  minAnnualizedYield?: number;
  maxRecommendationsPerSymbol?: number;
  roll?: Partial<RollSettings>;
}

interface RawWatchlist {
  symbols: string[];
}

// ---------------------------------------------------------------------------
// Loaded config bundle
// ---------------------------------------------------------------------------

export interface LoadedConfig {
  readonly evaluationDate: string;
  readonly portfolio: Portfolio;
  readonly chains: ReadonlyMap<string, OptionChain>;
  readonly settings: StrategySettings;
  readonly overrides: readonly TickerOverride[];
  /** Per-ticker price/IV used for chain generation. Exposed for CLI display. */
  readonly marketPrices: ReadonlyMap<string, { price: number; iv: number }>;
}

/**
 * Load all config files and produce the runtime bundle.
 *
 * This is the single entry point that replaces the old hard-coded fixtures.
 * In demo mode (no config edits), the JSON files ship with the repo and
 * produce the same output as Phase 1.
 */
export function loadConfig(): LoadedConfig {
  const holdings = readJson('holdings.json') as RawHoldings;
  const market = readJson('market.json') as RawMarket;
  const settingsRaw = readJson('settings.json') as RawSettings;
  const overridesRaw = readJson('overrides.json') as RawOverride[];
  const watchlistRaw = readJson('watchlist.json') as RawWatchlist;

  // Build price lookup.
  const marketPrices = new Map<string, { price: number; iv: number }>();
  for (const [sym, data] of Object.entries(market.tickers)) {
    marketPrices.set(sym, data);
  }

  // Merge holdings + market prices → StockPosition[].
  const stocks: StockPosition[] = holdings.stocks.map((s) => {
    const mkt = marketPrices.get(s.symbol);
    if (!mkt) {
      throw new Error(
        `No market price in market.json for holding "${s.symbol}". ` +
          `Add it to tickers or remove from holdings.`,
      );
    }
    return {
      id: `stk-${s.symbol.toLowerCase()}`,
      symbol: s.symbol,
      shares: s.shares,
      avgCostBasis: s.avgCostBasis,
      currentPrice: mkt.price,
    };
  });

  // Open options.
  const options: OptionPosition[] = holdings.openOptions.map((o) => ({
    id: `opt-${o.symbol.toLowerCase()}-${o.type.toLowerCase()}-${o.strike}-${o.expiration.slice(5).replace('-', '')}`,
    symbol: o.symbol,
    type: o.type,
    strike: o.strike,
    expiration: o.expiration,
    contracts: o.contracts,
    openPrice: o.openPrice,
    side: o.side,
    originalDte: o.originalDte,
    openedOn: o.openedOn,
  }));

  // Closed trades.
  const closedTrades: ClosedTrade[] = holdings.closedTrades.map((t, i) => ({
    id: `ct-${i + 1}`,
    symbol: t.symbol,
    type: t.type,
    contracts: t.contracts,
    netPremium: t.netPremium,
    closedOn: t.closedOn,
  }));

  const portfolio: Portfolio = {
    cash: holdings.cash,
    stocks,
    options,
    closedTrades,
    watchlist: watchlistRaw.symbols,
  };

  // Strategy settings.
  const settings: StrategySettings = {
    targetDeltaRange: settingsRaw.targetDeltaRange,
    minDTE: settingsRaw.minDTE,
    maxDTE: settingsRaw.maxDTE,
    minPremiumPct: settingsRaw.minPremiumPct,
    minAnnualizedYield: settingsRaw.minAnnualizedYield,
    maxRecommendationsPerSymbol: settingsRaw.maxRecommendationsPerSymbol,
    roll: settingsRaw.roll,
  };

  // Ticker overrides — only carry defined fields so effectiveSettings
  // falls back to globals for anything not explicitly set.
  const overrides: TickerOverride[] = overridesRaw.map((o) => {
    const result: TickerOverride = {
      symbol: o.symbol,
      ...(o.note !== undefined && { note: o.note }),
      ...(o.targetDeltaRange !== undefined && {
        targetDeltaRange: o.targetDeltaRange,
      }),
      ...(o.minDTE !== undefined && { minDTE: o.minDTE }),
      ...(o.maxDTE !== undefined && { maxDTE: o.maxDTE }),
      ...(o.minPremiumPct !== undefined && {
        minPremiumPct: o.minPremiumPct,
      }),
      ...(o.minAnnualizedYield !== undefined && {
        minAnnualizedYield: o.minAnnualizedYield,
      }),
      ...(o.maxRecommendationsPerSymbol !== undefined && {
        maxRecommendationsPerSymbol: o.maxRecommendationsPerSymbol,
      }),
      ...(o.roll !== undefined && { roll: o.roll }),
    };
    return result;
  });

  // Generate chains from market data.
  const allSymbols = new Set([
    ...stocks.map((s) => s.symbol),
    ...watchlistRaw.symbols,
  ]);
  const chains = new Map<string, OptionChain>();
  for (const sym of allSymbols) {
    const mkt = marketPrices.get(sym);
    if (!mkt) continue;
    const chain = generateChain({
      symbol: sym,
      spot: mkt.price,
      ivAnnual: mkt.iv,
      expirations: market.expirations.map((e) => ({
        date: e.date,
        dte: e.dte,
      })),
      riskFreeRate: market.chainAssumptions.riskFreeRate,
      dividendYield: market.chainAssumptions.dividendYield,
    });
    chains.set(sym, chain);
  }

  return {
    evaluationDate: market.evaluationDate,
    portfolio,
    chains,
    settings,
    overrides,
    marketPrices,
  };
}
