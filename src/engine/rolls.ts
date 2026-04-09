/**
 * Roll recommendation engine.
 *
 * For each open SHORT option position, checks five roll triggers:
 *   1. DELTA         — |delta| >= settings.roll.deltaThreshold
 *   2. DTE_RATIO     — remaining DTE / original DTE <= settings.roll.dteRatioThreshold
 *   3. NEAR_STRIKE   — |spot - strike| / spot <= settings.roll.nearStrikePct
 *   4. MIN_DTE       — remaining DTE <= settings.roll.minDte
 *   5. PROFIT_CAPTURE — (openPrice - currentMid) / openPrice >= settings.roll.profitCapturePct
 *
 * If any trigger fires, the engine searches for a roll candidate: same or
 * further-out expiration, strike equal or better (further OTM), at a net
 * credit vs closing the current position at market mid.
 *
 * Phase 2: accepts per-ticker overrides for roll thresholds.
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type { OptionPosition } from '../types/positions.js';
import type {
  RollRecommendation,
  RollTriggerDetail,
} from '../types/recommendations.js';
import { styleTagFromDelta } from '../types/recommendations.js';
import {
  effectiveSettings,
  type RollSettings,
  type StrategySettings,
  type TickerOverride,
} from '../types/settings.js';
import { annualizedYield, computeScore, type ScoreInputs } from './scoring.js';

interface CurrentContractView {
  readonly mid: number;
  readonly delta: number;
  readonly dte: number;
}

/**
 * Find the current market contract that corresponds to an open position.
 * Returns undefined if the chain has no matching strike/expiration.
 */
function currentMarketForPosition(
  position: OptionPosition,
  chain: OptionChain,
): CurrentContractView | undefined {
  const slice = chain.expirations.find((e) => e.date === position.expiration);
  if (!slice) return undefined;
  const legs = position.type === 'CALL' ? slice.calls : slice.puts;
  const match = legs.find((c) => c.strike === position.strike);
  if (!match) return undefined;
  return { mid: match.mid, delta: match.delta, dte: match.dte };
}

/**
 * Evaluate all five roll triggers. Returns the list of triggers that fired.
 */
function evaluateRollTriggers(
  position: OptionPosition,
  current: CurrentContractView,
  spot: number,
  roll: RollSettings,
): readonly RollTriggerDetail[] {
  const triggers: RollTriggerDetail[] = [];

  // 1. Delta threshold
  if (Math.abs(current.delta) >= roll.deltaThreshold) {
    triggers.push({
      label: 'DELTA',
      message: `|delta| ${Math.abs(current.delta).toFixed(2)} >= threshold ${roll.deltaThreshold.toFixed(2)}`,
    });
  }

  // 2. DTE ratio threshold
  if (
    position.originalDte > 0 &&
    current.dte / position.originalDte <= roll.dteRatioThreshold
  ) {
    const pct = ((current.dte / position.originalDte) * 100).toFixed(0);
    triggers.push({
      label: 'DTE_RATIO',
      message: `DTE ${current.dte}/${position.originalDte} (${pct}%) <= threshold ${(roll.dteRatioThreshold * 100).toFixed(0)}%`,
    });
  }

  // 3. Near strike
  const nearStrike = Math.abs(spot - position.strike) / spot;
  if (nearStrike <= roll.nearStrikePct) {
    triggers.push({
      label: 'NEAR_STRIKE',
      message: `Spot $${spot.toFixed(2)} is ${(nearStrike * 100).toFixed(1)}% from strike $${position.strike.toFixed(2)} (<= ${(roll.nearStrikePct * 100).toFixed(0)}% threshold)`,
    });
  }

  // 4. Min DTE
  if (current.dte <= roll.minDte) {
    triggers.push({
      label: 'MIN_DTE',
      message: `Only ${current.dte}d remaining (<= ${roll.minDte}d minimum)`,
    });
  }

  // 5. Profit capture
  if (position.openPrice > 0) {
    const captured =
      (position.openPrice - current.mid) / position.openPrice;
    if (captured >= roll.profitCapturePct) {
      triggers.push({
        label: 'PROFIT_CAPTURE',
        message: `${(captured * 100).toFixed(0)}% of max profit captured (>= ${(roll.profitCapturePct * 100).toFixed(0)}% threshold) — consider closing or rolling`,
      });
    }
  }

  return triggers;
}

/**
 * "Better strike" in roll direction:
 *   - for a short CALL, better means strike >= current strike (up or same)
 *   - for a short PUT,  better means strike <= current strike (down or same)
 */
function isStrikeEqualOrBetter(
  position: OptionPosition,
  candidateStrike: number,
): boolean {
  if (position.type === 'CALL') return candidateStrike >= position.strike;
  return candidateStrike <= position.strike;
}

interface RollCandidate {
  readonly slice: { readonly date: string; readonly dte: number };
  readonly contract: OptionContract;
  readonly netCredit: number;
}

function enumerateRollCandidates(
  position: OptionPosition,
  chain: OptionChain,
  currentMid: number,
): readonly RollCandidate[] {
  const candidates: RollCandidate[] = [];
  for (const slice of chain.expirations) {
    if (slice.date < position.expiration) continue;
    const legs = position.type === 'CALL' ? slice.calls : slice.puts;
    for (const c of legs) {
      if (!isStrikeEqualOrBetter(position, c.strike)) continue;
      const netCredit = (c.mid - currentMid) * 100 * position.contracts;
      if (netCredit <= 0) continue;
      if (slice.date === position.expiration && c.strike === position.strike) {
        continue;
      }
      candidates.push({
        slice: { date: slice.date, dte: c.dte },
        contract: c,
        netCredit,
      });
    }
  }
  return candidates;
}

/**
 * Generate roll recommendations for open short-option positions.
 *
 * Inputs:
 *   - openOptionPositions: user's current open option legs
 *   - chains:              map from symbol → OptionChain
 *   - settings:            global strategy defaults
 *   - overrides:           per-ticker overrides (roll thresholds can differ)
 *
 * Output: at most one roll recommendation per triggered position, selected
 * by largest net credit then best score. Each recommendation includes which
 * specific triggers fired.
 *
 * Assumptions:
 *   - Only SHORT positions are considered.
 *   - Roll is a 1:1 contract swap at strictly positive net credit.
 *   - All five triggers are evaluated; any single trigger firing is enough.
 */
export function generateRollRecommendations(
  openOptionPositions: readonly OptionPosition[],
  chains: ReadonlyMap<string, OptionChain>,
  settings: StrategySettings,
  overrides?: readonly TickerOverride[],
): readonly RollRecommendation[] {
  const overrideBySymbol = new Map<string, TickerOverride>();
  if (overrides) {
    for (const o of overrides) overrideBySymbol.set(o.symbol, o);
  }

  const out: RollRecommendation[] = [];
  for (const pos of openOptionPositions) {
    if (pos.side !== 'SHORT') continue;
    const chain = chains.get(pos.symbol);
    if (!chain) continue;
    const current = currentMarketForPosition(pos, chain);
    if (!current) continue;

    const eff = effectiveSettings(
      settings,
      overrideBySymbol.get(pos.symbol),
    );
    const triggers = evaluateRollTriggers(
      pos,
      current,
      chain.underlyingPrice,
      eff.roll,
    );
    if (triggers.length === 0) continue;

    const currentMid = current.mid;
    const candidates = enumerateRollCandidates(pos, chain, currentMid);
    if (candidates.length === 0) continue;

    const scored = candidates.map((cand) => {
      const notional = chain.underlyingPrice * 100;
      const ay = annualizedYield(
        cand.contract.mid * 100,
        notional,
        cand.contract.dte,
      );
      const upsidePct =
        pos.type === 'CALL'
          ? (cand.contract.strike - chain.underlyingPrice) /
            chain.underlyingPrice
          : (chain.underlyingPrice - cand.contract.strike) /
            chain.underlyingPrice;
      const assignmentProb = Math.abs(cand.contract.delta);
      const scoreInputs: ScoreInputs = {
        annualizedYield: ay,
        distancePct: upsidePct,
        assignmentProb,
        costBasisMarginPct: upsidePct,
        assignmentPreference: eff.assignmentPreference,
        strategyMode: eff.strategyMode,
        compounder: false,
      };
      const score = computeScore(scoreInputs);
      return { cand, ay, upsidePct, assignmentProb, score };
    });

    scored.sort((a, b) => {
      if (b.cand.netCredit !== a.cand.netCredit) {
        return b.cand.netCredit - a.cand.netCredit;
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.cand.slice.date.localeCompare(b.cand.slice.date);
    });

    const best = scored[0];
    if (!best) continue;

    const triggerSummary = triggers
      .map((t) => `[${t.label}] ${t.message}`)
      .join('\n    ');

    const closeCost = currentMid * 100 * pos.contracts;
    const newPremium = best.cand.contract.mid * 100 * pos.contracts;

    const rationale: string[] = [
      `Triggers fired:\n    ${triggerSummary}`,
      `Roll ${pos.type} $${pos.strike.toFixed(2)} ${pos.expiration} → $${best.cand.contract.strike.toFixed(2)} ${best.cand.slice.date} (${best.cand.contract.dte}d).`,
      `Buy back @ $${closeCost.toFixed(0)}, sell new @ $${newPremium.toFixed(0)} → net credit $${best.cand.netCredit.toFixed(0)}.`,
      `New delta ${best.cand.contract.delta.toFixed(2)} (${styleTagFromDelta(Math.abs(best.cand.contract.delta))}).`,
    ];

    const cycleYield =
      chain.underlyingPrice > 0
        ? (best.cand.contract.mid * 100) /
          (chain.underlyingPrice * 100)
        : 0;

    out.push({
      symbol: pos.symbol,
      action: 'ROLL',
      contract: best.cand.contract,
      expiration: best.cand.slice.date,
      currentPrice: chain.underlyingPrice,
      contractsAvailable: pos.contracts,
      premium: best.cand.contract.mid * 100,
      totalPremium: newPremium,
      cycleYield,
      upsidePct: best.upsidePct,
      annualizedYield: best.ay,
      assignmentProb: best.assignmentProb,
      score: best.score,
      styleTag: styleTagFromDelta(best.assignmentProb),
      rationale,
      relatedPositionId: pos.id,
      netCredit: best.cand.netCredit,
      triggers,
    });
  }
  return out;
}
