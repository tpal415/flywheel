/**
 * Covered call recommendation engine.
 *
 * Given a portfolio, option chains, and strategy settings, returns the
 * top-ranked short-call candidates for each eligible stock position.
 *
 * Phase 2 additions:
 *   - styleTag (Safer / Balanced / Income) based on |delta|
 *   - cycleYield (raw premium/notional, not annualized)
 *   - contractsAvailable / totalPremium for multi-lot positions
 *   - currentPrice on every rec for display
 *   - richer rationale explaining why strike + expiration fits settings
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
  contractsAvailable: number,
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

      const cycleYield = notional > 0 ? premium / notional : 0;
      const upsidePct =
        (call.strike - stock.currentPrice) / stock.currentPrice;
      const assignmentProb = absDelta;
      const score = computeScore(ay, upsidePct, assignmentProb);
      const styleTag = styleTagFromDelta(absDelta);
      const rationale = buildRationale(
        stock,
        call,
        premium,
        ay,
        cycleYield,
        upsidePct,
        styleTag,
        settings,
      );

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
        styleTag,
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
  styleTag: string,
  settings: StrategySettings,
): readonly string[] {
  const lines: string[] = [];
  lines.push(
    `${styleTag} pick: delta ${call.delta.toFixed(2)} within [${settings.targetDeltaRange[0]}, ${settings.targetDeltaRange[1]}] range.`,
  );
  lines.push(
    `Strike $${call.strike.toFixed(2)} is ${(upsidePct * 100).toFixed(1)}% above spot $${stock.currentPrice.toFixed(2)} — room to run before assignment.`,
  );
  lines.push(
    `Above cost basis $${stock.avgCostBasis.toFixed(2)} — assignment would be profitable.`,
  );
  lines.push(
    `$${premium.toFixed(0)} premium over ${call.dte}d = ${(cycleYield * 100).toFixed(2)}% cycle / ${(ay * 100).toFixed(1)}% annualized.`,
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
 * Output: top `maxRecommendationsPerSymbol` CC recs per eligible position,
 * sorted by score within each symbol. Symbols are sorted alphabetically.
 *
 * Assumptions:
 *   - A position is "eligible" iff it holds ≥100 uncovered shares.
 *   - assignmentProb ≈ |delta| (documented approximation).
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

  // Sort stocks alphabetically for deterministic ticker ordering.
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
    const candidates = findCoveredCallCandidates(
      stock,
      chain,
      eff,
      contractsAvailable,
    );
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
