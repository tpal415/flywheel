/**
 * Cash-secured put recommendation engine — primary + secondary per ticker.
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
  readonly settings: ReturnType<typeof effectiveSettings>;
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
  const maxContracts = Math.floor(cashAvailable / cashRequired);

  const score = computeScore({
    annualizedYield: ay,
    distancePct: upsidePct,
    assignmentProb,
    costBasisMarginPct: upsidePct,
    assignmentPreference: settings.assignmentPreference,
    strategyMode: settings.strategyMode,
    compounder: false,
  });

  const rationale: string[] = [
    `Entry at $${put.strike.toFixed(2)} = ${(upsidePct * 100).toFixed(1)}% discount to spot $${spot.toFixed(2)}.`,
    `$${premium.toFixed(0)} premium (${(cycleYield * 100).toFixed(2)}% cycle, ${(ay * 100).toFixed(1)}% ann.) at delta ${put.delta.toFixed(2)}.`,
    `Cash: $${cashRequired.toFixed(0)}/contract, ${maxContracts} affordable.`,
  ];

  const liqWarnings: string[] = [];
  if (put.ask > 0 && put.bid > 0) {
    const spreadPct = (put.ask - put.bid) / put.mid;
    if (spreadPct > 0.10)
      liqWarnings.push(`Wide spread: $${put.bid.toFixed(2)}/$${put.ask.toFixed(2)} (${(spreadPct * 100).toFixed(0)}% of mid)`);
  }
  if (put.openInterest < 50)
    liqWarnings.push(`Low open interest: ${put.openInterest}`);

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
    styleTag: styleTagFromDelta(absDelta),
    rationale,
    warnings: liqWarnings,
    positionCapped: false,
    cashRequired,
  };
}

/**
 * Generate CSP recommendations: 1 primary + 1 secondary per watchlist ticker.
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

    if (candidates.length > 0) {
      results.push(candidates[0]!);
      const primary = candidates[0]!;
      const secondary = candidates.find(
        (r) =>
          r.contract.strike !== primary.contract.strike ||
          r.expiration !== primary.expiration,
      );
      if (secondary) results.push(secondary);
    }
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
