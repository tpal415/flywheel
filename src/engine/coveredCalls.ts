/**
 * Covered call recommendation engine.
 *
 * Given a portfolio, option chains, and strategy settings, returns the
 * top-ranked short-call candidates for each eligible stock position.
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type {
  OptionPosition,
  Portfolio,
  StockPosition,
} from '../types/positions.js';
import type { SellCoveredCallRecommendation } from '../types/recommendations.js';
import {
  effectiveSettings,
  type StrategySettings,
  type TickerOverride,
} from '../types/settings.js';
import { annualizedYield, computeScore } from './scoring.js';

/**
 * Calculate the number of shares already reserved by existing short calls.
 */
function sharesCoveredByShortCalls(
  symbol: string,
  options: readonly OptionPosition[],
): number {
  return options
    .filter(
      (o) => o.symbol === symbol && o.type === 'CALL' && o.side === 'SHORT',
    )
    .reduce((sum, o) => sum + o.contracts * 100, 0);
}

/**
 * Select candidate contracts from a chain for covered-call sales.
 *
 * Filters applied:
 *  - DTE in [minDTE, maxDTE]
 *  - strike >= avgCostBasis (never sell calls below cost)
 *  - strike > currentPrice (OTM only)
 *  - |delta| within the target range
 *  - premium % >= minPremiumPct
 *  - annualized yield >= minAnnualizedYield
 */
function findCoveredCallCandidates(
  stock: StockPosition,
  chain: OptionChain,
  settings: StrategySettings,
): readonly SellCoveredCallRecommendation[] {
  const [lo, hi] = settings.targetDeltaRange;
  const recs: SellCoveredCallRecommendation[] = [];

  for (const slice of chain.expirations) {
    for (const call of slice.calls) {
      if (call.dte < settings.minDTE || call.dte > settings.maxDTE) continue;
      if (call.strike < stock.avgCostBasis) continue;
      if (call.strike <= stock.currentPrice) continue;
      const absDelta = Math.abs(call.delta);
      if (absDelta < lo || absDelta > hi) continue;

      const premium = call.mid * 100;
      const notional = stock.currentPrice * 100;
      const premiumPct = premium / notional;
      if (premiumPct < settings.minPremiumPct) continue;

      const ay = annualizedYield(premium, notional, call.dte);
      if (ay < settings.minAnnualizedYield) continue;

      const upsidePct = (call.strike - stock.currentPrice) / stock.currentPrice;
      // assignmentProb ≈ |delta|. See module doc in recommendations.ts.
      const assignmentProb = absDelta;
      const score = computeScore(ay, upsidePct, assignmentProb);
      const rationale = buildRationale(stock, call, premium, ay, upsidePct);

      recs.push({
        symbol: stock.symbol,
        action: 'SELL_CC',
        contract: call,
        expiration: slice.date,
        premium,
        upsidePct,
        annualizedYield: ay,
        assignmentProb,
        score,
        rationale,
      });
    }
  }

  return recs;
}

function buildRationale(
  stock: StockPosition,
  call: OptionContract,
  premium: number,
  ay: number,
  upsidePct: number,
): readonly string[] {
  const lines: string[] = [];
  lines.push(
    `Strike $${call.strike.toFixed(2)} is $${(
      call.strike - stock.currentPrice
    ).toFixed(2)} (${(upsidePct * 100).toFixed(1)}%) above spot $${stock.currentPrice.toFixed(
      2,
    )}.`,
  );
  lines.push(
    `Strike is ${
      call.strike >= stock.avgCostBasis
        ? 'at or above'
        : 'BELOW'
    } cost basis $${stock.avgCostBasis.toFixed(2)}.`,
  );
  lines.push(
    `Premium $${premium.toFixed(0)} over ${call.dte}d → ${(ay * 100).toFixed(
      1,
    )}% annualized yield.`,
  );
  lines.push(
    `Delta ${call.delta.toFixed(2)} ≈ ${(Math.abs(call.delta) * 100).toFixed(
      0,
    )}% assignment probability.`,
  );
  return lines;
}

/**
 * Generate covered-call recommendations across a portfolio.
 *
 * Inputs:
 *   - portfolio:      user's full portfolio (stocks + open options)
 *   - chains:         map from symbol → OptionChain with fresh data
 *   - settings:       global strategy defaults
 *   - overrides:      per-ticker overrides applied on top of globals
 *
 * Output: ranked covered-call recommendations, at most
 * `settings.maxRecommendationsPerSymbol` per eligible position, sorted by
 * score descending.
 *
 * Assumptions:
 *   - A position is "eligible" iff it holds ≥100 uncovered shares.
 *   - `chains[symbol].underlyingPrice` is authoritative if present, but the
 *     stock position's `currentPrice` is used for yield and upside math so
 *     callers can model stale chain data deliberately.
 *   - assignmentProb is approximated as |delta|. Black-Scholes delta is NOT
 *     the same as N(d2) (the true risk-neutral P(assignment)), but for plain
 *     OTM short calls within the 0.15–0.35 delta band the approximation is
 *     within a couple of percentage points and is the industry shorthand.
 */
export function generateCoveredCallRecommendations(
  portfolio: Portfolio,
  chains: ReadonlyMap<string, OptionChain>,
  settings: StrategySettings,
  overrides: readonly TickerOverride[],
): readonly SellCoveredCallRecommendation[] {
  const overrideBySymbol = new Map<string, TickerOverride>();
  for (const o of overrides) overrideBySymbol.set(o.symbol, o);

  const results: SellCoveredCallRecommendation[] = [];

  for (const stock of portfolio.stocks) {
    const covered = sharesCoveredByShortCalls(stock.symbol, portfolio.options);
    const uncovered = stock.shares - covered;
    if (uncovered < 100) continue;

    const chain = chains.get(stock.symbol);
    if (!chain) continue;

    const eff = effectiveSettings(settings, overrideBySymbol.get(stock.symbol));
    const candidates = findCoveredCallCandidates(stock, chain, eff);
    const sorted = [...candidates].sort(deterministicScoreCompare);
    results.push(...sorted.slice(0, eff.maxRecommendationsPerSymbol));
  }

  return results;
}

/**
 * Deterministic ordering: score desc, then yield desc, then strike asc,
 * then dte asc. Guarantees stable output across runs.
 */
function deterministicScoreCompare(
  a: SellCoveredCallRecommendation,
  b: SellCoveredCallRecommendation,
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.annualizedYield !== a.annualizedYield) {
    return b.annualizedYield - a.annualizedYield;
  }
  if (a.contract.strike !== b.contract.strike) {
    return a.contract.strike - b.contract.strike;
  }
  return a.contract.dte - b.contract.dte;
}
