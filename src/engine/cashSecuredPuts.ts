/**
 * Cash-secured put recommendation engine.
 *
 * For each symbol on the watchlist, finds short-put candidates whose cash
 * reserve fits inside the user's available cash.
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type { SellCashSecuredPutRecommendation } from '../types/recommendations.js';
import {
  effectiveSettings,
  type StrategySettings,
  type TickerOverride,
} from '../types/settings.js';
import { annualizedYield, computeScore } from './scoring.js';

interface CspCandidateInputs {
  readonly symbol: string;
  readonly spot: number;
  readonly put: OptionContract;
  readonly expirationDate: string;
  readonly cashAvailable: number;
  readonly settings: StrategySettings;
}

function evaluatePut(
  inputs: CspCandidateInputs,
): SellCashSecuredPutRecommendation | undefined {
  const { symbol, spot, put, expirationDate, cashAvailable, settings } = inputs;
  if (put.dte < settings.minDTE || put.dte > settings.maxDTE) return undefined;
  // Only consider OTM puts — strike below spot.
  if (put.strike >= spot) return undefined;

  const absDelta = Math.abs(put.delta);
  const [lo, hi] = settings.targetDeltaRange;
  if (absDelta < lo || absDelta > hi) return undefined;

  const cashRequired = put.strike * 100;
  if (cashRequired > cashAvailable) return undefined;

  const premium = put.mid * 100;
  const premiumPct = premium / cashRequired;
  if (premiumPct < settings.minPremiumPct) return undefined;

  const ay = annualizedYield(premium, cashRequired, put.dte);
  if (ay < settings.minAnnualizedYield) return undefined;

  const upsidePct = (spot - put.strike) / spot;
  const assignmentProb = absDelta;
  const score = computeScore(ay, upsidePct, assignmentProb);

  const rationale: string[] = [
    `Strike $${put.strike.toFixed(2)} is $${(
      spot - put.strike
    ).toFixed(2)} (${(upsidePct * 100).toFixed(
      1,
    )}%) below spot $${spot.toFixed(2)} — acceptable entry.`,
    `Cash required $${cashRequired.toFixed(
      0,
    )} fits inside available $${cashAvailable.toFixed(0)}.`,
    `Premium $${premium.toFixed(0)} over ${put.dte}d → ${(ay * 100).toFixed(
      1,
    )}% annualized yield on cash reserve.`,
    `Delta ${put.delta.toFixed(2)} ≈ ${(absDelta * 100).toFixed(
      0,
    )}% assignment probability.`,
  ];

  return {
    symbol,
    action: 'SELL_CSP',
    contract: put,
    expiration: expirationDate,
    premium,
    upsidePct,
    annualizedYield: ay,
    assignmentProb,
    score,
    rationale,
    cashRequired,
  };
}

/**
 * Generate cash-secured put recommendations.
 *
 * Inputs:
 *   - watchlist:      symbols the user is willing to own
 *   - cashAvailable:  dollars not already tied up in other reserves
 *   - chains:         map from symbol → OptionChain
 *   - settings:       global defaults
 *   - overrides:      per-ticker overrides
 *
 * Output: ranked CSP recommendations, at most
 * `settings.maxRecommendationsPerSymbol` per symbol. Sorted by score desc.
 *
 * Assumptions:
 *   - Only OTM puts are considered as entry candidates.
 *   - Cash requirement is strike * 100 per contract (no margin offset).
 *   - assignmentProb ≈ |delta| (documented approximation).
 *   - A rec is only produced if a single contract fits in `cashAvailable`;
 *     the engine never recommends a size that would blow the cash reserve.
 */
export function generateCashSecuredPutRecommendations(
  watchlist: readonly string[],
  cashAvailable: number,
  chains: ReadonlyMap<string, OptionChain>,
  settings: StrategySettings,
  overrides: readonly TickerOverride[],
): readonly SellCashSecuredPutRecommendation[] {
  const overrideBySymbol = new Map<string, TickerOverride>();
  for (const o of overrides) overrideBySymbol.set(o.symbol, o);

  const results: SellCashSecuredPutRecommendation[] = [];
  for (const symbol of watchlist) {
    const chain = chains.get(symbol);
    if (!chain) continue;
    const eff = effectiveSettings(settings, overrideBySymbol.get(symbol));
    const candidates: SellCashSecuredPutRecommendation[] = [];

    for (const slice of chain.expirations) {
      for (const put of slice.puts) {
        const rec = evaluatePut({
          symbol,
          spot: chain.underlyingPrice,
          put,
          expirationDate: slice.date,
          cashAvailable,
          settings: eff,
        });
        if (rec) candidates.push(rec);
      }
    }

    candidates.sort(deterministicScoreCompare);
    results.push(...candidates.slice(0, eff.maxRecommendationsPerSymbol));
  }

  return results;
}

function deterministicScoreCompare(
  a: SellCashSecuredPutRecommendation,
  b: SellCashSecuredPutRecommendation,
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.annualizedYield !== a.annualizedYield) {
    return b.annualizedYield - a.annualizedYield;
  }
  if (b.contract.strike !== a.contract.strike) {
    return b.contract.strike - a.contract.strike;
  }
  return a.contract.dte - b.contract.dte;
}
