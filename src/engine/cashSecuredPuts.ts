/**
 * Cash-secured put recommendation engine.
 *
 * For each symbol on the watchlist, finds short-put candidates whose cash
 * reserve fits inside the user's available cash.
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type { SellCashSecuredPutRecommendation } from '../types/recommendations.js';
import { styleTagFromDelta } from '../types/recommendations.js';
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

  const cycleYield = cashRequired > 0 ? premium / cashRequired : 0;
  const upsidePct = (spot - put.strike) / spot;
  const assignmentProb = absDelta;
  const score = computeScore(ay, upsidePct, assignmentProb);
  const styleTag = styleTagFromDelta(absDelta);
  const maxContracts = Math.floor(cashAvailable / cashRequired);

  const rationale: string[] = [
    `${styleTag} entry: delta ${put.delta.toFixed(2)} within [${settings.targetDeltaRange[0]}, ${settings.targetDeltaRange[1]}] range.`,
    `Strike $${put.strike.toFixed(2)} is ${(upsidePct * 100).toFixed(1)}% below spot $${spot.toFixed(2)} — acceptable entry if assigned.`,
    `Cash $${cashRequired.toFixed(0)}/contract × ${maxContracts} fits in $${cashAvailable.toFixed(0)}.`,
    `$${premium.toFixed(0)} premium over ${put.dte}d = ${(cycleYield * 100).toFixed(2)}% cycle / ${(ay * 100).toFixed(1)}% annualized.`,
  ];

  return {
    symbol,
    action: 'SELL_CSP',
    contract: put,
    expiration: expirationDate,
    currentPrice: spot,
    contractsAvailable: maxContracts,
    premium,
    totalPremium: premium * maxContracts,
    cycleYield,
    upsidePct,
    annualizedYield: ay,
    assignmentProb,
    score,
    styleTag,
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
 * `maxRecommendationsPerSymbol` per symbol, sorted by ticker then score.
 *
 * Assumptions:
 *   - Only OTM puts are considered.
 *   - Cash requirement is strike * 100 per contract (no margin offset).
 *   - assignmentProb ≈ |delta| (documented approximation).
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
  const sortedWatchlist = [...watchlist].sort();

  for (const symbol of sortedWatchlist) {
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
