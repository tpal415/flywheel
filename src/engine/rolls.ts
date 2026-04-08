/**
 * Roll recommendation engine.
 *
 * For each open SHORT option position, check the roll triggers:
 *   - |delta| exceeds settings.rollTriggerDelta, OR
 *   - remaining DTE / original DTE is below settings.rollTriggerDtePct
 *
 * If either trips, look for a roll candidate: same or further-out expiration,
 * strike equal or better (further OTM in the direction of the short), at a
 * net credit vs closing the current position at its current mid.
 */

import type { OptionChain, OptionContract } from '../types/chains.js';
import type { OptionPosition } from '../types/positions.js';
import type { RollRecommendation } from '../types/recommendations.js';
import type { StrategySettings } from '../types/settings.js';
import { annualizedYield, computeScore } from './scoring.js';

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

function shouldTriggerRoll(
  current: CurrentContractView,
  originalDte: number,
  settings: StrategySettings,
): { readonly triggered: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  let triggered = false;
  if (Math.abs(current.delta) >= settings.rollTriggerDelta) {
    triggered = true;
    reasons.push(
      `|delta| ${Math.abs(current.delta).toFixed(
        2,
      )} ≥ roll trigger ${settings.rollTriggerDelta.toFixed(2)}.`,
    );
  }
  if (
    originalDte > 0 &&
    current.dte / originalDte <= settings.rollTriggerDtePct
  ) {
    triggered = true;
    reasons.push(
      `Remaining DTE ${current.dte}/${originalDte} (${(
        (current.dte / originalDte) *
        100
      ).toFixed(0)}%) ≤ trigger ${(settings.rollTriggerDtePct * 100).toFixed(
        0,
      )}%.`,
    );
  }
  return { triggered, reasons };
}

/**
 * "Better strike" in roll direction:
 *   - for a short CALL, better means strike > current strike (up)
 *   - for a short PUT,  better means strike < current strike (down)
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
    // Same or further-out expiration.
    if (slice.date < position.expiration) continue;
    const legs = position.type === 'CALL' ? slice.calls : slice.puts;
    for (const c of legs) {
      if (!isStrikeEqualOrBetter(position, c.strike)) continue;
      // Net credit: new premium received − cost to close current short.
      const netCredit = (c.mid - currentMid) * 100 * position.contracts;
      if (netCredit <= 0) continue;
      // Skip the exact same contract.
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
 * Generate roll recommendations for the given open short-option positions.
 *
 * Inputs:
 *   - openOptionPositions: user's current open option legs
 *   - chains:              map from symbol → OptionChain
 *   - settings:            global strategy defaults (no per-ticker overrides
 *                          on rolls in phase 1 — keeps logic simple)
 *
 * Output: at most one roll recommendation per triggered position, selected
 * by largest net credit then best score. If no candidate clears a net credit,
 * no rec is produced for that position (caller should treat as "hold or
 * close" — a separate HOLD/CLOSE rec could be added later).
 *
 * Assumptions:
 *   - Only SHORT positions are considered. LONG positions are left alone.
 *   - A roll is constructed as a 1:1 contract swap (same contract count).
 *   - `originalDte` on the position feeds the time-decay trigger.
 *   - Candidate must be a strict improvement: same-or-further expiration,
 *     same-or-better strike, and strictly positive net credit.
 */
export function generateRollRecommendations(
  openOptionPositions: readonly OptionPosition[],
  chains: ReadonlyMap<string, OptionChain>,
  settings: StrategySettings,
): readonly RollRecommendation[] {
  const out: RollRecommendation[] = [];
  for (const pos of openOptionPositions) {
    if (pos.side !== 'SHORT') continue;
    const chain = chains.get(pos.symbol);
    if (!chain) continue;
    const current = currentMarketForPosition(pos, chain);
    if (!current) continue;

    const { triggered, reasons } = shouldTriggerRoll(
      current,
      pos.originalDte,
      settings,
    );
    if (!triggered) continue;

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
      const score = computeScore(ay, upsidePct, assignmentProb);
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

    const rationale: string[] = [
      `Roll trigger fired: ${reasons.join(' ')}`,
      `New strike $${best.cand.contract.strike.toFixed(
        2,
      )} exp ${best.cand.slice.date} (${best.cand.contract.dte}d).`,
      `Net credit $${best.cand.netCredit.toFixed(0)} after buying back $${(
        currentMid * 100 * pos.contracts
      ).toFixed(0)} and selling $${(
        best.cand.contract.mid * 100 * pos.contracts
      ).toFixed(0)}.`,
      `New delta ${best.cand.contract.delta.toFixed(2)}.`,
    ];

    out.push({
      symbol: pos.symbol,
      action: 'ROLL',
      contract: best.cand.contract,
      expiration: best.cand.slice.date,
      premium: best.cand.contract.mid * 100,
      upsidePct: best.upsidePct,
      annualizedYield: best.ay,
      assignmentProb: best.assignmentProb,
      score: best.score,
      rationale,
      relatedPositionId: pos.id,
      netCredit: best.cand.netCredit,
    });
  }
  return out;
}
