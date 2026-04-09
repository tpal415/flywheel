/**
 * Mock market data provider — wraps the existing synthetic chain generator
 * and reads prices/IV from config/market.json.
 *
 * This is the Phase 1–3 behavior: deterministic, offline, no network.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OptionChain } from '../types/chains.js';
import { generateChain } from '../fixtures/generateChain.js';
import type { MarketDataProvider, MarketSnapshot } from './types.js';

interface RawMarket {
  evaluationDate: string;
  expirations: { date: string; dte: number }[];
  tickers: Record<string, { price: number; iv: number }>;
  chainAssumptions: { riskFreeRate: number; dividendYield: number };
}

function readMarketJson(): RawMarket {
  const raw = readFileSync(
    join(import.meta.dirname, '..', '..', 'config', 'market.json'),
    'utf-8',
  );
  return JSON.parse(raw) as RawMarket;
}

export class MockProvider implements MarketDataProvider {
  async getMarketData(
    symbols: readonly string[],
    _riskFreeRate: number,
  ): Promise<MarketSnapshot> {
    const market = readMarketJson();
    const prices = new Map<string, number>();
    const chains = new Map<string, OptionChain>();
    const r = market.chainAssumptions.riskFreeRate;
    const q = market.chainAssumptions.dividendYield;

    for (const sym of symbols) {
      const mkt = market.tickers[sym];
      if (!mkt) continue;
      prices.set(sym, mkt.price);
      chains.set(
        sym,
        generateChain({
          symbol: sym,
          spot: mkt.price,
          ivAnnual: mkt.iv,
          expirations: market.expirations.map((e) => ({
            date: e.date,
            dte: e.dte,
          })),
          riskFreeRate: r,
          dividendYield: q,
        }),
      );
    }

    return {
      prices,
      chains,
      mode: 'mock',
      timestamp: new Date().toISOString(),
      source: `synthetic BS chains from config/market.json (eval date ${market.evaluationDate})`,
      warnings: [],
    };
  }
}
