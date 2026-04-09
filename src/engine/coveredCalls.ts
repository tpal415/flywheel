/**
 * Covered call recommendation engine — assignment-intent-aware.
 *
 * For each eligible stock position, returns a primary and secondary
 * recommendation. Filtering and scoring respect:
 *   - assignmentPreference (avoid/neutral/prefer)
 *   - compounder flag (penalty for capping upside too early)
 *   - minUpsidePct (hard floor for "avoid" tickers)
 *   - strategyMode (shifts delta + scoring weights)
 *   - cost basis distance (assignment profitability)
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type {
  OptionPosition,
  Portfolio,
  StockPosition,
} from '../types/positions.js';
import type { SellCoveredCallRecommendation } from '../types/recommendations.js';
import { styleTagFromDelta } from '../types/recommendations.js';
import {
  effectiveSettings,
  type EffectiveTickerSettings,
  type StrategySettings,
  type TickerOverride,
} from '../types/settings.js';
import { annualizedYield, computeScore } from './scoring.js';

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
 * Find all valid CC candidates for a stock position.
 *
 * Hard filters:
 *   - DTE in range
 *   - strike >= cost basis
 *   - strike > spot (OTM only)
 *   - |delta| in effective range
 *   - premium pct >= min
 *   - upside >= minUpsidePct (critical for "avoid" tickers)
 */
function findCandidates(
  stock: StockPosition,
  chain: OptionChain,
  eff: EffectiveTickerSettings,
  contractsAvailable: number,
): readonly SellCoveredCallRecommendation[] {
  const [lo, hi] = eff.targetDeltaRange;
  const recs: SellCoveredCallRecommendation[] = [];

  for (const slice of chain.expirations) {
    for (const call of slice.calls) {
      if (call.dte < eff.minDTE || call.dte > eff.maxDTE) continue;
      if (call.strike < stock.avgCostBasis) continue;
      if (call.strike <= stock.currentPrice) continue;

      const absDelta = Math.abs(call.delta);
      if (absDelta < lo || absDelta > hi) continue;

      const upsidePct =
        (call.strike - stock.currentPrice) / stock.currentPrice;

      // Hard floor: "avoid" tickers must have enough upside room.
      if (upsidePct < eff.minUpsidePct) continue;

      const premium = call.mid * 100;
      const notional = stock.currentPrice * 100;
      const premiumPct = premium / notional;
      if (premiumPct < eff.minPremiumPct) continue;

      const ay = annualizedYield(premium, notional, call.dte);
      if (ay < eff.minAnnualizedYield) continue;

      const cycleYield = notional > 0 ? premium / notional : 0;
      const assignmentProb = absDelta;
      const costBasisMarginPct =
        stock.avgCostBasis > 0
          ? (call.strike - stock.avgCostBasis) / stock.avgCostBasis
          : 0;

      const score = computeScore({
        annualizedYield: ay,
        distancePct: upsidePct,
        assignmentProb,
        costBasisMarginPct,
        assignmentPreference: eff.assignmentPreference,
        strategyMode: eff.strategyMode,
        compounder: eff.compounder,
      });

      const rationale = buildRationale(stock, call, premium, ay, cycleYield, upsidePct, eff);

      recs.push({
        symbol: stock.symbol,
        action: 'SELL_CC',
        contract: call,
        expiration: slice.date,
        currentPrice: stock.currentPrice,
        contractsAvailable,
        premium,
        totalPremium: premium * contractsAvailable,
        cycleYield,
        upsidePct,
        annualizedYield: ay,
        assignmentProb,
        score,
        styleTag: styleTagFromDelta(absDelta),
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
  cycleYield: number,
  upsidePct: number,
  eff: EffectiveTickerSettings,
): readonly string[] {
  const lines: string[] = [];
  const absDelta = Math.abs(call.delta);
  const prefLabel =
    eff.assignmentPreference === 'avoid'
      ? 'Protecting upside'
      : eff.assignmentPreference === 'prefer'
        ? 'Maximizing income'
        : 'Balancing income vs. upside';

  lines.push(
    `${prefLabel}: ${(upsidePct * 100).toFixed(1)}% room above $${stock.currentPrice.toFixed(2)} before assignment at $${call.strike.toFixed(2)}.`,
  );

  const cbMargin = ((call.strike - stock.avgCostBasis) / stock.avgCostBasis * 100).toFixed(1);
  lines.push(
    `Strike $${call.strike.toFixed(2)} is ${cbMargin}% above cost basis $${stock.avgCostBasis.toFixed(2)} — assignment locks in profit.`,
  );

  lines.push(
    `$${premium.toFixed(0)} premium (${(cycleYield * 100).toFixed(2)}% cycle, ${(ay * 100).toFixed(1)}% ann.) at delta ${absDelta.toFixed(2)} (${(absDelta * 100).toFixed(0)}% P(assign)).`,
  );

  if (eff.compounder) {
    lines.push(
      `Compounder: further OTM preferred to avoid capping long-term upside.`,
    );
  }

  return lines;
}

/**
 * Generate covered-call recommendations: 1 primary + 1 secondary per ticker.
 *
 * Inputs:
 *   - portfolio, chains, settings, overrides (as before)
 *
 * Output: exactly 2 recs per eligible ticker (or 1 if only 1 candidate
 * passes filters), sorted alphabetically by symbol. Primary is the
 * highest-scored candidate. Secondary is the next-best with a different
 * strike or expiration.
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

  const sortedStocks = [...portfolio.stocks].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  for (const stock of sortedStocks) {
    const covered = sharesCoveredByShortCalls(stock.symbol, portfolio.options);
    const uncovered = stock.shares - covered;
    if (uncovered < 100) continue;

    const contractsAvailable = Math.floor(uncovered / 100);
    const chain = chains.get(stock.symbol);
    if (!chain) continue;

    const eff = effectiveSettings(settings, overrideBySymbol.get(stock.symbol));
    const candidates = findCandidates(stock, chain, eff, contractsAvailable);
    const sorted = [...candidates].sort(deterministicScoreCompare);

    // Primary: best score.
    if (sorted.length > 0) {
      results.push(sorted[0]!);
    }
    // Secondary: next-best with a different strike OR expiration.
    const primary = sorted[0];
    if (primary) {
      const secondary = sorted.find(
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
