/**
 * Deterministic synthetic option-chain generator.
 *
 * Produces an `OptionChain` for a given symbol + spot + IV using Black-Scholes
 * for theoretical value and delta. Strikes span ±25% of spot at $1 or $2.50
 * increments (chosen by spot magnitude). A small symmetric bid/ask spread is
 * applied around mid as a function of DTE and moneyness so the numbers are
 * internally consistent.
 *
 * The function is deterministic: same inputs → same outputs. There is no
 * randomness anywhere in this file.
 */

import type {
  ExpirationSlice,
  OptionChain,
  OptionContract,
} from '../types/chains.js';
import { bsCall, bsPut, callDelta, putDelta } from '../engine/blackScholes.js';

const DEFAULT_RISK_FREE = 0.045;
const DEFAULT_DIV_YIELD = 0.0;

export interface ChainExpirationInput {
  /** ISO date string YYYY-MM-DD of the expiration. */
  readonly date: string;
  /** Days-to-expiration measured from the evaluation date. */
  readonly dte: number;
}

export interface GenerateChainOptions {
  readonly symbol: string;
  readonly spot: number;
  /** Annualized IV as a decimal (0.45 == 45%). Used as the ATM baseline. */
  readonly ivAnnual: number;
  readonly expirations: readonly ChainExpirationInput[];
  readonly riskFreeRate?: number;
  readonly dividendYield?: number;
  /** Deterministic per-contract open-interest seed base. */
  readonly oiSeed?: number;
}

function strikeIncrement(spot: number): number {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 300) return 2.5;
  return 5;
}

function buildStrikes(spot: number): readonly number[] {
  const inc = strikeIncrement(spot);
  const lo = spot * 0.75;
  const hi = spot * 1.25;
  const first = Math.ceil(lo / inc) * inc;
  const strikes: number[] = [];
  for (let k = first; k <= hi + 1e-9; k += inc) {
    // Round to avoid floating-point drift across increments.
    strikes.push(Math.round(k * 100) / 100);
  }
  return strikes;
}

/**
 * Simple IV skew: ivAnnual baseline at ATM, OTM puts get a small bump,
 * far OTM calls get a small reduction. Deterministic.
 */
function skewedIv(baseIv: number, spot: number, strike: number): number {
  const m = Math.log(strike / spot); // moneyness
  // Put-side smile: lower strikes → higher IV, capped.
  const skew = -0.25 * m;
  const iv = baseIv + skew * baseIv;
  // Clamp to a sensible band.
  return Math.max(0.05, Math.min(3.0, iv));
}

/**
 * Bid/ask spread as a fraction of mid. ATM, longer-DTE options tighter;
 * far-OTM, short-DTE options wider. Deterministic, 1–3% of mid.
 */
function spreadFraction(moneyness: number, dte: number): number {
  const distance = Math.min(0.25, Math.abs(moneyness));
  const dteFactor = Math.max(0.5, Math.min(1.5, 30 / Math.max(1, dte)));
  const base = 0.01 + distance * 0.08; // 1% ATM → 3% at 25% OTM
  return Math.max(0.01, Math.min(0.03, base * dteFactor));
}

/** Deterministic pseudo-OI: not random, just a stable function of inputs. */
function syntheticOpenInterest(
  seed: number,
  strike: number,
  dte: number,
  isCall: boolean,
): number {
  const base = Math.abs(
    Math.sin(seed * 12.9898 + strike * 78.233 + dte * 37.719 + (isCall ? 1 : 0)),
  );
  return Math.round(100 + base * 4900);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildContract(
  isCall: boolean,
  strike: number,
  spot: number,
  dte: number,
  baseIv: number,
  r: number,
  q: number,
  oiSeed: number,
): OptionContract {
  const t = Math.max(1e-6, dte / 365);
  const iv = skewedIv(baseIv, spot, strike);
  const bsInputs = { s: spot, k: strike, t, r, sigma: iv, q };
  const theo = isCall ? bsCall(bsInputs) : bsPut(bsInputs);
  const mid = Math.max(0.01, theo);
  const m = Math.log(strike / spot);
  const frac = spreadFraction(m, dte);
  const half = (mid * frac) / 2;
  const bid = Math.max(0.01, round2(mid - half));
  const ask = Math.max(bid + 0.01, round2(mid + half));
  const midRounded = round2((bid + ask) / 2);
  const delta = isCall ? callDelta(bsInputs) : putDelta(bsInputs);
  return {
    strike,
    bid,
    ask,
    mid: midRounded,
    delta: Math.round(delta * 10000) / 10000,
    iv: Math.round(iv * 10000) / 10000,
    openInterest: syntheticOpenInterest(oiSeed, strike, dte, isCall),
    dte,
  };
}

/**
 * Generate a full option chain for a symbol.
 *
 * Inputs are documented via the `GenerateChainOptions` interface.
 * Returns an `OptionChain` with one `ExpirationSlice` per entry in
 * `expirations`, each containing calls and puts across the strike grid.
 */
export function generateChain(opts: GenerateChainOptions): OptionChain {
  const { symbol, spot, ivAnnual, expirations } = opts;
  const r = opts.riskFreeRate ?? DEFAULT_RISK_FREE;
  const q = opts.dividendYield ?? DEFAULT_DIV_YIELD;
  const oiSeed = opts.oiSeed ?? symbolSeed(symbol);
  const strikes = buildStrikes(spot);

  const slices: ExpirationSlice[] = expirations.map((exp) => {
    const calls = strikes.map((k) =>
      buildContract(true, k, spot, exp.dte, ivAnnual, r, q, oiSeed),
    );
    const puts = strikes.map((k) =>
      buildContract(false, k, spot, exp.dte, ivAnnual, r, q, oiSeed),
    );
    return { date: exp.date, calls, puts };
  });

  return {
    symbol,
    underlyingPrice: spot,
    expirations: slices,
  };
}

/** Stable numeric seed derived from a symbol's code points. */
function symbolSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  // Map to a small float domain so sine-based OI stays varied.
  return (h % 10_000) / 10;
}
