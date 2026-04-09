/**
 * Real market data provider — Yahoo Finance via yahoo-finance2.
 *
 * Fetches:
 *   - Current stock prices via quote()
 *   - Option chains via options() for up to 3 nearest expirations
 *
 * Yahoo does NOT return greeks (delta/gamma/theta). We compute delta
 * from the implied volatility using our Black-Scholes module. This is
 * documented as a limitation in the CLI output.
 *
 * Requires network access. Falls back gracefully with a clear error
 * message when offline.
 */

import YahooFinance from 'yahoo-finance2';
import type {
  ExpirationSlice,
  OptionChain,
  OptionContract,
} from '../types/chains.js';
import { callDelta, putDelta } from '../engine/blackScholes.js';
import type { MarketDataProvider, MarketSnapshot } from './types.js';

const MAX_EXPIRATIONS = 3;
const REQUEST_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Compute DTE from today to an expiration date. */
function computeDte(expirationDate: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expirationDate);
  exp.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / 86_400_000));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function buildContract(
  raw: {
    strike?: number;
    bid?: number;
    ask?: number;
    impliedVolatility?: number;
    openInterest?: number;
  },
  isCall: boolean,
  spot: number,
  dte: number,
  riskFreeRate: number,
): OptionContract | undefined {
  const strike = raw.strike;
  const bid = raw.bid ?? 0;
  const ask = raw.ask ?? 0;
  const iv = raw.impliedVolatility ?? 0;
  if (!strike || strike <= 0) return undefined;
  if (bid <= 0 && ask <= 0) return undefined;

  const mid = Math.round(((bid + ask) / 2) * 100) / 100;
  const t = Math.max(1e-6, dte / 365);
  const bsIn = { s: spot, k: strike, t, r: riskFreeRate, sigma: iv || 0.3 };
  const delta = isCall ? callDelta(bsIn) : putDelta(bsIn);

  return {
    strike,
    bid: Math.max(0.01, bid),
    ask: Math.max(bid + 0.01, ask),
    mid: Math.max(0.01, mid),
    delta: round4(delta),
    iv: round4(iv || 0.3),
    openInterest: raw.openInterest ?? 0,
    dte,
  };
}

export class YahooProvider implements MarketDataProvider {
  private readonly yf: InstanceType<typeof YahooFinance>;

  constructor() {
    this.yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }

  async getMarketData(
    symbols: readonly string[],
    riskFreeRate: number,
  ): Promise<MarketSnapshot> {
    const prices = new Map<string, number>();
    const chains = new Map<string, OptionChain>();
    const warnings: string[] = [];

    // 1. Fetch all quotes in one batch.
    console.error(`[yahoo] Fetching quotes for ${symbols.join(', ')}...`);
    for (const sym of symbols) {
      try {
        const q = await this.yf.quote(sym);
        const price = q.regularMarketPrice;
        if (typeof price === 'number' && price > 0) {
          prices.set(sym, price);
        } else {
          warnings.push(`${sym}: no valid price from Yahoo`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`${sym}: quote fetch failed — ${msg}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    // 2. Fetch option chains.
    for (const sym of symbols) {
      const spot = prices.get(sym);
      if (!spot) continue;

      try {
        console.error(`[yahoo] Fetching options for ${sym}...`);
        const result = await this.yf.options(sym);

        // Pick up to MAX_EXPIRATIONS nearest expirations.
        const expDates = (result.expirationDates ?? [])
          .filter((d): d is Date => d instanceof Date)
          .slice(0, MAX_EXPIRATIONS);

        if (expDates.length === 0) {
          warnings.push(`${sym}: no expirations available`);
          continue;
        }

        const slices: ExpirationSlice[] = [];

        // The first options() call returns the nearest expiration.
        if (result.options?.[0]) {
          const dte = computeDte(expDates[0]!);
          if (dte > 0) {
            const slice = mapSlice(result.options[0], expDates[0]!, spot, dte, riskFreeRate);
            if (slice) slices.push(slice);
          }
        }

        // Fetch remaining expirations individually.
        for (let i = 1; i < expDates.length; i++) {
          await sleep(REQUEST_DELAY_MS);
          try {
            const expResult = await this.yf.options(sym, {
              date: expDates[i]!,
            });
            const dte = computeDte(expDates[i]!);
            if (dte > 0 && expResult.options?.[0]) {
              const slice = mapSlice(expResult.options[0], expDates[i]!, spot, dte, riskFreeRate);
              if (slice) slices.push(slice);
            }
          } catch {
            warnings.push(`${sym}: failed to fetch expiration ${toIsoDate(expDates[i]!)}`);
          }
        }

        if (slices.length > 0) {
          chains.set(sym, { symbol: sym, underlyingPrice: spot, expirations: slices });
        } else {
          warnings.push(`${sym}: no valid option slices`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`${sym}: options fetch failed — ${msg}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    warnings.push('Delta computed from Yahoo IV via Black-Scholes (not from exchange).');

    return {
      prices,
      chains,
      mode: 'real',
      timestamp: new Date().toISOString(),
      source: 'Yahoo Finance (yahoo-finance2)',
      warnings,
    };
  }
}

interface YahooOptionLeg {
  strike?: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
  openInterest?: number;
}

interface YahooOptionSlice {
  calls?: YahooOptionLeg[];
  puts?: YahooOptionLeg[];
}

function mapSlice(
  raw: YahooOptionSlice,
  expDate: Date,
  spot: number,
  dte: number,
  riskFreeRate: number,
): ExpirationSlice | undefined {
  const calls = (raw.calls ?? [])
    .map((c) => buildContract(c, true, spot, dte, riskFreeRate))
    .filter((c): c is OptionContract => c !== undefined);
  const puts = (raw.puts ?? [])
    .map((p) => buildContract(p, false, spot, dte, riskFreeRate))
    .filter((p): p is OptionContract => p !== undefined);

  if (calls.length === 0 && puts.length === 0) return undefined;
  return { date: toIsoDate(expDate), calls, puts };
}
