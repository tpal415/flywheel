/**
 * Real market data provider — Polygon.io REST API.
 *
 * Polygon provides:
 *   - Stock prices via /v2/aggs/ticker/{ticker}/prev
 *   - Full option chain snapshots via /v3/snapshot/options/{underlying}
 *     including greeks (delta, gamma, theta, vega) and IV directly
 *
 * Unlike Yahoo Finance, Polygon returns exchange-reported greeks so we
 * do NOT need to compute delta from IV via Black-Scholes. If greeks are
 * missing on a specific contract we fall back to BS computation.
 *
 * Requires a Polygon API key set via:
 *   - POLYGON_API_KEY environment variable, or
 *   - config/polygon.json file: { "apiKey": "..." }
 *
 * Free tier: 5 calls/min. Paid tiers are faster.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExpirationSlice,
  OptionChain,
  OptionContract,
} from '../types/chains.js';
import { callDelta, putDelta } from '../engine/blackScholes.js';
import type { MarketDataProvider, MarketSnapshot } from './types.js';

const REQUEST_DELAY_MS = 350;
const MAX_EXPIRATIONS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function computeDte(expirationDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expirationDate + 'T00:00:00');
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / 86_400_000));
}

function resolveApiKey(): string {
  // 1. Environment variable.
  const envKey = process.env['POLYGON_API_KEY'];
  if (envKey) return envKey;

  // 2. Config file.
  try {
    const raw = readFileSync(
      join(import.meta.dirname, '..', '..', 'config', 'polygon.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { apiKey?: string };
    if (parsed.apiKey) return parsed.apiKey;
  } catch {
    // File doesn't exist — that's fine.
  }

  throw new Error(
    'Polygon API key not found. Set POLYGON_API_KEY env var or create config/polygon.json with { "apiKey": "..." }',
  );
}

// ---------------------------------------------------------------------------
// Polygon REST response shapes
// ---------------------------------------------------------------------------

interface PolygonPrevResponse {
  status: string;
  results?: { c?: number; o?: number; h?: number; l?: number }[];
}

interface PolygonGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

interface PolygonOptionDetail {
  contract_type?: string;
  exercise_style?: string;
  expiration_date?: string;
  strike_price?: number;
  ticker?: string;
}

interface PolygonDayBar {
  close?: number;
  open?: number;
}

interface PolygonSnapshotResult {
  break_even_price?: number;
  day?: PolygonDayBar;
  details?: PolygonOptionDetail;
  greeks?: PolygonGreeks;
  implied_volatility?: number;
  open_interest?: number;
  underlying_asset?: { price?: number };
  last_quote?: { ask?: number; bid?: number };
}

interface PolygonSnapshotResponse {
  status: string;
  results?: PolygonSnapshotResult[];
  next_url?: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class PolygonProvider implements MarketDataProvider {
  private readonly apiKey: string;

  constructor() {
    this.apiKey = resolveApiKey();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${sep}apiKey=${this.apiKey}`;
    const res = await fetch(fullUrl);
    if (!res.ok) {
      throw new Error(`Polygon ${res.status}: ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  }

  async getSpotPrice(symbol: string): Promise<number | undefined> {
    try {
      const data = await this.fetchJson<PolygonPrevResponse>(
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev`,
      );
      return data.results?.[0]?.c ?? undefined;
    } catch {
      return undefined;
    }
  }

  async getOptionChain(
    symbol: string,
    riskFreeRate: number,
  ): Promise<OptionChain | undefined> {
    const spot = await this.getSpotPrice(symbol);
    if (!spot) return undefined;

    try {
      const allResults = await this.fetchAllPages(symbol);
      if (allResults.length === 0) return undefined;

      // Group by expiration date, pick nearest MAX_EXPIRATIONS.
      const byExp = new Map<string, PolygonSnapshotResult[]>();
      for (const r of allResults) {
        const exp = r.details?.expiration_date;
        if (!exp) continue;
        let group = byExp.get(exp);
        if (!group) {
          group = [];
          byExp.set(exp, group);
        }
        group.push(r);
      }

      const sortedExps = [...byExp.keys()].sort().slice(0, MAX_EXPIRATIONS);
      const slices: ExpirationSlice[] = [];

      for (const exp of sortedExps) {
        const dte = computeDte(exp);
        if (dte <= 0) continue;
        const contracts = byExp.get(exp) ?? [];
        const calls: OptionContract[] = [];
        const puts: OptionContract[] = [];

        for (const c of contracts) {
          const mapped = mapContract(c, spot, dte, riskFreeRate);
          if (!mapped) continue;
          const type = c.details?.contract_type?.toLowerCase();
          if (type === 'call') calls.push(mapped);
          else if (type === 'put') puts.push(mapped);
        }

        if (calls.length > 0 || puts.length > 0) {
          slices.push({ date: exp, calls, puts });
        }
      }

      if (slices.length === 0) return undefined;
      return { symbol, underlyingPrice: spot, expirations: slices };
    } catch {
      return undefined;
    }
  }

  async getMarketData(
    symbols: readonly string[],
    riskFreeRate: number,
  ): Promise<MarketSnapshot> {
    const prices = new Map<string, number>();
    const chains = new Map<string, OptionChain>();
    const warnings: string[] = [];
    let greeksFromExchange = false;

    for (const sym of symbols) {
      console.error(`[polygon] ${sym}: fetching price...`);
      try {
        const price = await this.getSpotPrice(sym);
        if (price !== undefined) {
          prices.set(sym, price);
        } else {
          warnings.push(`${sym}: no price from Polygon`);
        }
      } catch (e: unknown) {
        warnings.push(
          `${sym}: price fetch failed — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await sleep(REQUEST_DELAY_MS);

      const spot = prices.get(sym);
      if (!spot) continue;

      console.error(`[polygon] ${sym}: fetching option chain...`);
      try {
        const chain = await this.getOptionChain(sym, riskFreeRate);
        if (chain) {
          chains.set(sym, chain);
          greeksFromExchange = true;
        } else {
          warnings.push(`${sym}: no option chain from Polygon`);
        }
      } catch (e: unknown) {
        warnings.push(
          `${sym}: chain fetch failed — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }

    if (!greeksFromExchange) {
      warnings.push(
        'No exchange greeks retrieved. Delta computed from IV via Black-Scholes.',
      );
    }

    return {
      prices,
      chains,
      mode: 'real',
      timestamp: new Date().toISOString(),
      source: 'Polygon.io',
      warnings,
    };
  }

  /**
   * Fetch all pages of the option chain snapshot.
   * Polygon paginates with next_url; we follow until exhausted.
   */
  private async fetchAllPages(
    symbol: string,
  ): Promise<PolygonSnapshotResult[]> {
    const all: PolygonSnapshotResult[] = [];
    let url: string | undefined =
      `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(symbol)}?limit=250`;

    while (url) {
      const page: PolygonSnapshotResponse =
        await this.fetchJson<PolygonSnapshotResponse>(url);
      if (page.results) {
        all.push(...page.results);
      }
      url = page.next_url ?? undefined;
      if (url) await sleep(REQUEST_DELAY_MS);
    }

    return all;
  }
}

// ---------------------------------------------------------------------------
// Contract mapping
// ---------------------------------------------------------------------------

function mapContract(
  raw: PolygonSnapshotResult,
  spot: number,
  dte: number,
  riskFreeRate: number,
): OptionContract | undefined {
  const strike = raw.details?.strike_price;
  if (!strike || strike <= 0) return undefined;

  const bid = raw.last_quote?.bid ?? 0;
  const ask = raw.last_quote?.ask ?? 0;
  if (bid <= 0 && ask <= 0) return undefined;

  const iv = raw.implied_volatility ?? 0;
  const isCall = raw.details?.contract_type?.toLowerCase() === 'call';

  // Prefer exchange-reported delta; fall back to BS if missing.
  let delta = raw.greeks?.delta;
  if (delta === undefined || delta === null) {
    const t = Math.max(1e-6, dte / 365);
    const bsIn = { s: spot, k: strike, t, r: riskFreeRate, sigma: iv || 0.3 };
    delta = isCall ? callDelta(bsIn) : putDelta(bsIn);
  }

  const mid = Math.round(((bid + ask) / 2) * 100) / 100;

  return {
    strike,
    bid: Math.max(0.01, bid),
    ask: Math.max(bid + 0.01, ask),
    mid: Math.max(0.01, mid),
    delta: round4(delta),
    iv: round4(iv || 0.3),
    openInterest: raw.open_interest ?? 0,
    dte,
  };
}
