/**
 * Config loader — reads editable JSON files from config/ and produces the
 * runtime types the engine consumes.
 *
 * Supports two modes:
 *   - "mock" (default): chains generated synthetically from market.json
 *   - "real": chains + prices from a MarketDataProvider (e.g. Yahoo Finance)
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
  AssignmentPreference,
  RollSettings,
  StrategyMode,
  StrategySettings,
  TickerOverride,
} from '../types/settings.js';
import { generateChain } from '../fixtures/generateChain.js';
import type { DataMode, MarketSnapshot } from '../data/types.js';

function configPath(filename: string): string {
  return join(import.meta.dirname, '..', '..', 'config', filename);
}

function readJson(filename: string): unknown {
  const raw = readFileSync(configPath(filename), 'utf-8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_STRATEGY_MODES: readonly string[] = [
  'incomeFocused',
  'balanced',
  'upsideFocused',
];
const VALID_ASSIGNMENT_PREFS: readonly string[] = [
  'avoid',
  'neutral',
  'prefer',
];

const VALID_SIDES = ['SHORT', 'LONG'];
const VALID_TYPES = ['CALL', 'PUT'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateRange(v: number, lo: number, hi: number): boolean {
  return typeof v === 'number' && !Number.isNaN(v) && v >= lo && v <= hi;
}

/**
 * Validate all config files. Returns a list of error strings.
 * Empty array means everything is valid.
 */
export function validateConfig(
  holdings: RawHoldings,
  market: RawMarket,
  settings: RawSettings,
  overrides: readonly RawOverride[],
  skipMarketTickers: boolean,
): readonly string[] {
  const e: string[] = [];

  // --- Holdings ---------------------------------------------------------
  if (typeof holdings.cash !== 'number' || holdings.cash < 0)
    e.push('holdings: cash must be a non-negative number');

  for (const s of holdings.stocks) {
    const tag = `holdings: stock ${s.symbol || '(empty)'}`;
    if (!s.symbol || s.symbol.trim() === '') e.push(`${tag}: empty symbol`);
    if (!Number.isFinite(s.shares) || s.shares <= 0)
      e.push(`${tag}: shares must be positive`);
    if (!Number.isFinite(s.avgCostBasis) || s.avgCostBasis <= 0)
      e.push(`${tag}: avgCostBasis must be positive`);
  }

  for (const o of holdings.openOptions) {
    const tag = `holdings: option ${o.symbol || '?'} ${o.type} ${o.strike} ${o.expiration}`;
    if (!o.symbol) e.push(`${tag}: empty symbol`);
    if (!VALID_TYPES.includes(o.type))
      e.push(`${tag}: type must be CALL or PUT`);
    if (!VALID_SIDES.includes(o.side))
      e.push(`${tag}: side must be SHORT or LONG`);
    if (!Number.isFinite(o.strike) || o.strike <= 0)
      e.push(`${tag}: strike must be positive`);
    if (!Number.isFinite(o.contracts) || o.contracts <= 0)
      e.push(`${tag}: contracts must be positive`);
    if (!Number.isFinite(o.openPrice) || o.openPrice < 0)
      e.push(`${tag}: openPrice must be non-negative`);
    if (!Number.isFinite(o.originalDte) || o.originalDte <= 0)
      e.push(`${tag}: originalDte must be positive`);
    if (!o.expiration || !DATE_RE.test(o.expiration))
      e.push(`${tag}: expiration must be YYYY-MM-DD`);
    if (!o.openedOn || !DATE_RE.test(o.openedOn))
      e.push(`${tag}: openedOn must be YYYY-MM-DD`);
  }

  for (const t of holdings.closedTrades) {
    const tag = `holdings: closedTrade ${t.symbol || '?'}`;
    if (!t.symbol) e.push(`${tag}: empty symbol`);
    if (!VALID_TYPES.includes(t.type))
      e.push(`${tag}: type must be CALL or PUT`);
    if (!Number.isFinite(t.contracts) || t.contracts <= 0)
      e.push(`${tag}: contracts must be positive`);
    if (!Number.isFinite(t.netPremium))
      e.push(`${tag}: netPremium must be a number`);
    if (!t.closedOn || !DATE_RE.test(t.closedOn))
      e.push(`${tag}: closedOn must be YYYY-MM-DD`);
  }

  // --- Market -----------------------------------------------------------
  if (!market.evaluationDate || !DATE_RE.test(market.evaluationDate))
    e.push('market: evaluationDate must be YYYY-MM-DD');

  if (!skipMarketTickers) {
    if (!market.expirations || market.expirations.length === 0)
      e.push('market: need at least one expiration');
    for (const exp of market.expirations) {
      if (!exp.date || !DATE_RE.test(exp.date))
        e.push(`market: expiration date "${exp.date}" must be YYYY-MM-DD`);
      if (!Number.isFinite(exp.dte) || exp.dte <= 0)
        e.push(`market: expiration ${exp.date} has non-positive DTE`);
    }
    for (const s of holdings.stocks) {
      if (s.symbol && !market.tickers[s.symbol])
        e.push(`market: missing price for holding "${s.symbol}"`);
    }
    for (const [sym, data] of Object.entries(market.tickers)) {
      if (!Number.isFinite(data.price) || data.price <= 0)
        e.push(`market: ${sym} price must be positive`);
      if (!Number.isFinite(data.iv) || data.iv <= 0 || data.iv > 5)
        e.push(`market: ${sym} IV ${data.iv} looks wrong (expected 0 < iv <= 5)`);
    }
  }

  // --- Settings ---------------------------------------------------------
  if (!VALID_STRATEGY_MODES.includes(settings.strategyMode))
    e.push(`settings: strategyMode "${settings.strategyMode}" must be one of ${VALID_STRATEGY_MODES.join(', ')}`);
  const [dLo, dHi] = settings.targetDeltaRange;
  if (!validateRange(dLo, 0, 1) || !validateRange(dHi, 0, 1) || dLo > dHi)
    e.push('settings: targetDeltaRange must be [0..1] with lo <= hi');
  if (!Number.isFinite(settings.minDTE) || settings.minDTE < 0)
    e.push('settings: minDTE must be non-negative');
  if (!Number.isFinite(settings.maxDTE) || settings.maxDTE < settings.minDTE)
    e.push('settings: maxDTE must be >= minDTE');
  if (!Number.isFinite(settings.minPremiumPct) || settings.minPremiumPct < 0)
    e.push('settings: minPremiumPct must be non-negative');
  if (!Number.isFinite(settings.minAnnualizedYield) || settings.minAnnualizedYield < 0)
    e.push('settings: minAnnualizedYield must be non-negative');

  // Roll settings.
  const r = settings.roll;
  if (!validateRange(r.deltaThreshold, 0, 1))
    e.push('settings: roll.deltaThreshold must be in [0, 1]');
  if (!validateRange(r.dteRatioThreshold, 0, 1))
    e.push('settings: roll.dteRatioThreshold must be in [0, 1]');
  if (!validateRange(r.nearStrikePct, 0, 1))
    e.push('settings: roll.nearStrikePct must be in [0, 1]');
  if (!Number.isFinite(r.minDte) || r.minDte < 0)
    e.push('settings: roll.minDte must be non-negative');
  if (!validateRange(r.profitCapturePct, 0, 1))
    e.push('settings: roll.profitCapturePct must be in [0, 1]');

  // --- Overrides --------------------------------------------------------
  for (const o of overrides) {
    const tag = `overrides: ${o.symbol || '(empty)'}`;
    if (!o.symbol) e.push(`${tag}: empty symbol`);
    if (o.assignmentPreference !== undefined && !VALID_ASSIGNMENT_PREFS.includes(o.assignmentPreference))
      e.push(`${tag}: assignmentPreference "${o.assignmentPreference}" invalid`);
    if (o.minUpsidePct !== undefined && !validateRange(o.minUpsidePct, 0, 1))
      e.push(`${tag}: minUpsidePct must be in [0, 1]`);
    if (o.targetDeltaRange !== undefined) {
      const [oLo, oHi] = o.targetDeltaRange;
      if (!validateRange(oLo, 0, 1) || !validateRange(oHi, 0, 1) || oLo > oHi)
        e.push(`${tag}: targetDeltaRange must be [0..1] with lo <= hi`);
    }
  }

  return e;
}

function throwIfInvalid(errors: readonly string[]): void {
  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Run config validation against on-disk files and return the error list.
 * Returns empty array if everything is valid.
 */
export function validateConfigFiles(): readonly string[] {
  const holdings = readJson('holdings.json') as RawHoldings;
  const market = readJson('market.json') as RawMarket;
  const settingsRaw = readJson('settings.json') as RawSettings;
  const overridesRaw = readJson('overrides.json') as RawOverride[];
  return validateConfig(holdings, market, settingsRaw, overridesRaw, false);
}

// ---------------------------------------------------------------------------
// Raw JSON shapes
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
  strategyMode: string;
  targetDeltaRange: [number, number];
  minDTE: number;
  maxDTE: number;
  minPremiumPct: number;
  minAnnualizedYield: number;
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
  assignmentPreference?: string;
  compounder?: boolean;
  minUpsidePct?: number;
  targetDeltaRange?: [number, number];
  minDTE?: number;
  maxDTE?: number;
  minPremiumPct?: number;
  minAnnualizedYield?: number;
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
  readonly marketPrices: ReadonlyMap<string, { price: number; iv: number }>;
  /** Data source metadata — present when loaded via loadConfigWithData(). */
  readonly dataSource?: {
    readonly mode: DataMode;
    readonly timestamp: string;
    readonly source: string;
    readonly warnings: readonly string[];
  };
}

/**
 * Load config in mock mode (synchronous, offline). Same as Phase 1–3.
 */
export function loadConfig(): LoadedConfig {
  const holdings = readJson('holdings.json') as RawHoldings;
  const market = readJson('market.json') as RawMarket;
  const settingsRaw = readJson('settings.json') as RawSettings;
  const overridesRaw = readJson('overrides.json') as RawOverride[];
  const watchlistRaw = readJson('watchlist.json') as RawWatchlist;

  throwIfInvalid(validateConfig(holdings, market, settingsRaw, overridesRaw, false));

  const marketPrices = new Map<string, { price: number; iv: number }>();
  for (const [sym, data] of Object.entries(market.tickers)) {
    marketPrices.set(sym, data);
  }

  const { portfolio, settings, overrides } = buildCoreConfig(
    holdings, settingsRaw, overridesRaw, watchlistRaw, marketPrices,
  );

  const allSymbols = new Set([
    ...portfolio.stocks.map((s) => s.symbol),
    ...watchlistRaw.symbols,
  ]);
  const chains = new Map<string, OptionChain>();
  for (const sym of allSymbols) {
    const mkt = marketPrices.get(sym);
    if (!mkt) continue;
    chains.set(
      sym,
      generateChain({
        symbol: sym,
        spot: mkt.price,
        ivAnnual: mkt.iv,
        expirations: market.expirations.map((e) => ({ date: e.date, dte: e.dte })),
        riskFreeRate: market.chainAssumptions.riskFreeRate,
        dividendYield: market.chainAssumptions.dividendYield,
      }),
    );
  }

  return {
    evaluationDate: market.evaluationDate,
    portfolio,
    chains,
    settings,
    overrides,
    marketPrices,
    dataSource: {
      mode: 'mock',
      timestamp: new Date().toISOString(),
      source: `synthetic BS chains from config/market.json`,
      warnings: [],
    },
  };
}

/**
 * Load config and inject real or mock market data from a MarketSnapshot.
 *
 * In "real" mode, stock prices come from the snapshot (not market.json),
 * and chains come from the provider. market.json is still used as a
 * fallback for any symbol the provider couldn't fetch.
 */
export function loadConfigWithData(snapshot: MarketSnapshot): LoadedConfig {
  const holdings = readJson('holdings.json') as RawHoldings;
  const market = readJson('market.json') as RawMarket;
  const settingsRaw = readJson('settings.json') as RawSettings;
  const overridesRaw = readJson('overrides.json') as RawOverride[];
  const watchlistRaw = readJson('watchlist.json') as RawWatchlist;

  // In real mode, skip market.json ticker validation (prices come from provider).
  throwIfInvalid(validateConfig(holdings, market, settingsRaw, overridesRaw, snapshot.mode === 'real'));

  // Merge prices: real data takes precedence, market.json as fallback.
  const marketPrices = new Map<string, { price: number; iv: number }>();
  for (const [sym, data] of Object.entries(market.tickers)) {
    marketPrices.set(sym, data);
  }
  // Overwrite with live prices when available.
  for (const [sym, price] of snapshot.prices) {
    const existing = marketPrices.get(sym);
    marketPrices.set(sym, { price, iv: existing?.iv ?? 0.3 });
  }

  const { portfolio, settings, overrides } = buildCoreConfig(
    holdings, settingsRaw, overridesRaw, watchlistRaw, marketPrices,
  );

  // Use snapshot chains, fall back to synthetic for any missing symbol.
  const allSymbols = new Set([
    ...portfolio.stocks.map((s) => s.symbol),
    ...watchlistRaw.symbols,
  ]);
  const chains = new Map<string, OptionChain>();
  for (const sym of allSymbols) {
    const realChain = snapshot.chains.get(sym);
    if (realChain) {
      chains.set(sym, realChain);
    } else {
      const mkt = marketPrices.get(sym);
      if (mkt && mkt.iv > 0) {
        chains.set(
          sym,
          generateChain({
            symbol: sym,
            spot: mkt.price,
            ivAnnual: mkt.iv,
            expirations: market.expirations.map((e) => ({ date: e.date, dte: e.dte })),
            riskFreeRate: market.chainAssumptions.riskFreeRate,
            dividendYield: market.chainAssumptions.dividendYield,
          }),
        );
      }
    }
  }

  const evalDate =
    snapshot.mode === 'real'
      ? new Date().toISOString().slice(0, 10)
      : market.evaluationDate;

  return {
    evaluationDate: evalDate,
    portfolio,
    chains,
    settings,
    overrides,
    marketPrices,
    dataSource: {
      mode: snapshot.mode,
      timestamp: snapshot.timestamp,
      source: snapshot.source,
      warnings: snapshot.warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildCoreConfig(
  holdings: RawHoldings,
  settingsRaw: RawSettings,
  overridesRaw: readonly RawOverride[],
  watchlistRaw: RawWatchlist,
  marketPrices: ReadonlyMap<string, { price: number; iv: number }>,
): {
  portfolio: Portfolio;
  settings: StrategySettings;
  overrides: TickerOverride[];
} {
  const stocks: StockPosition[] = holdings.stocks.map((s) => {
    const mkt = marketPrices.get(s.symbol);
    return {
      id: `stk-${s.symbol.toLowerCase()}`,
      symbol: s.symbol,
      shares: s.shares,
      avgCostBasis: s.avgCostBasis,
      currentPrice: mkt?.price ?? 0,
    };
  });

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

  const settings: StrategySettings = {
    strategyMode: settingsRaw.strategyMode as StrategyMode,
    targetDeltaRange: settingsRaw.targetDeltaRange,
    minDTE: settingsRaw.minDTE,
    maxDTE: settingsRaw.maxDTE,
    minPremiumPct: settingsRaw.minPremiumPct,
    minAnnualizedYield: settingsRaw.minAnnualizedYield,
    roll: settingsRaw.roll,
  };

  const overrides: TickerOverride[] = overridesRaw.map((o) => ({
    symbol: o.symbol,
    ...(o.note !== undefined && { note: o.note }),
    ...(o.assignmentPreference !== undefined && {
      assignmentPreference: o.assignmentPreference as AssignmentPreference,
    }),
    ...(o.compounder !== undefined && { compounder: o.compounder }),
    ...(o.minUpsidePct !== undefined && { minUpsidePct: o.minUpsidePct }),
    ...(o.targetDeltaRange !== undefined && { targetDeltaRange: o.targetDeltaRange }),
    ...(o.minDTE !== undefined && { minDTE: o.minDTE }),
    ...(o.maxDTE !== undefined && { maxDTE: o.maxDTE }),
    ...(o.minPremiumPct !== undefined && { minPremiumPct: o.minPremiumPct }),
    ...(o.minAnnualizedYield !== undefined && { minAnnualizedYield: o.minAnnualizedYield }),
    ...(o.roll !== undefined && { roll: o.roll }),
  }));

  return { portfolio, settings, overrides };
}
