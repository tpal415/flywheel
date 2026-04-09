/**
 * Market data provider abstraction.
 *
 * Both "mock" (synthetic Black-Scholes chains from config) and "real"
 * (live market data) implement this interface. The engine and CLI consume
 * the same types regardless of which provider generated the data.
 */

import type { OptionChain } from '../types/chains.js';

export type DataMode = 'mock' | 'real';

export interface MarketSnapshot {
  /** Map from symbol → current spot price. */
  readonly prices: ReadonlyMap<string, number>;
  /** Map from symbol → option chain. */
  readonly chains: ReadonlyMap<string, OptionChain>;
  /** "mock" or "real" — printed in CLI output. */
  readonly mode: DataMode;
  /** ISO timestamp of when the data was fetched/generated. */
  readonly timestamp: string;
  /** Human-readable data source label (e.g. "Yahoo Finance", "synthetic BS"). */
  readonly source: string;
  /** Per-symbol notes (e.g. "delta computed from IV via BS"). */
  readonly warnings: readonly string[];
}

export interface MarketDataProvider {
  /**
   * Fetch or generate market data for the given symbols.
   *
   * @param symbols   Symbols to retrieve data for.
   * @param riskFreeRate  Risk-free rate for delta computation (when greeks
   *                      are not available from the source).
   */
  getMarketData(
    symbols: readonly string[],
    riskFreeRate: number,
  ): Promise<MarketSnapshot>;
}
