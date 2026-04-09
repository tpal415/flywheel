#!/usr/bin/env node
/**
 * CLI harness — personalized wheel copilot.
 *
 * Sections:
 *   1. COVERED CALLS — 1 primary + 1 alt per ticker, with recommended action
 *   2. ROLL ALERTS   — triggered positions
 *   3. CSP IDEAS     — 1 primary + 1 alt per watchlist ticker
 *   4. INCOME SUMMARY
 */

import Table from 'cli-table3';
import { loadConfig, type LoadedConfig } from '../config/index.js';
import {
  generateCashSecuredPutRecommendations,
  generateCoveredCallRecommendations,
  generateRollRecommendations,
} from '../engine/index.js';
import type {
  Recommendation,
  RollRecommendation,
  SellCashSecuredPutRecommendation,
  SellCoveredCallRecommendation,
} from '../types/recommendations.js';
import { effectiveSettings, type TickerOverride } from '../types/settings.js';

function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function money(x: number, digits = 0): string {
  return `$${x.toFixed(digits)}`;
}

function printHeader(title: string): void {
  const bar = '='.repeat(title.length + 4);
  console.log(`\n${bar}\n  ${title}\n${bar}`);
}

function groupBy<T>(arr: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    let group = map.get(k);
    if (!group) {
      group = [];
      map.set(k, group);
    }
    group.push(item);
  }
  return map;
}

function prefLabel(pref: string): string {
  switch (pref) {
    case 'avoid': return 'AVOID assignment';
    case 'prefer': return 'OK to assign';
    default: return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Section 1: Covered Calls
// ---------------------------------------------------------------------------

function printCoveredCalls(
  ccs: readonly SellCoveredCallRecommendation[],
  cfg: LoadedConfig,
): void {
  printHeader('1. COVERED CALLS');
  if (ccs.length === 0) {
    console.log('(no covered call candidates matched current filters)');
    return;
  }

  const overrideBySymbol = new Map<string, TickerOverride>();
  for (const o of cfg.overrides) overrideBySymbol.set(o.symbol, o);
  const grouped = groupBy(ccs, (r) => r.symbol);

  for (const [symbol, recs] of grouped) {
    const primary = recs[0]!;
    const alt = recs[1];
    const eff = effectiveSettings(cfg.settings, overrideBySymbol.get(symbol));
    const stock = cfg.portfolio.stocks.find((s) => s.symbol === symbol)!;
    const gain = ((primary.currentPrice - stock.avgCostBasis) / stock.avgCostBasis * 100).toFixed(1);

    console.log(`\n  ${symbol}  spot $${primary.currentPrice.toFixed(2)} | cost $${stock.avgCostBasis.toFixed(2)} (${Number(gain) >= 0 ? '+' : ''}${gain}%) | ${primary.contractsAvailable}x100 avail | ${prefLabel(eff.assignmentPreference)}${eff.compounder ? ' | compounder' : ''}`);
    console.log(`  >> Sell ${primary.contractsAvailable}x ${symbol} $${primary.contract.strike.toFixed(2)}C ${primary.expiration} (${primary.contract.dte}d)`);

    const table = new Table({
      head: ['', 'Strike', 'Exp', 'DTE', 'Prem/c', 'Total', 'Cycle%', 'Upside%', 'P(asgn)', 'Score'],
      colAligns: ['left', 'right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: ['cyan'] },
    });

    table.push([
      'Primary',
      money(primary.contract.strike, 2),
      primary.expiration,
      String(primary.contract.dte),
      money(primary.premium, 0),
      money(primary.totalPremium, 0),
      pct(primary.cycleYield, 2),
      pct(primary.upsidePct, 1),
      pct(primary.assignmentProb, 0),
      primary.score.toFixed(3),
    ]);

    if (alt) {
      table.push([
        'Alt',
        money(alt.contract.strike, 2),
        alt.expiration,
        String(alt.contract.dte),
        money(alt.premium, 0),
        money(alt.totalPremium, 0),
        pct(alt.cycleYield, 2),
        pct(alt.upsidePct, 1),
        pct(alt.assignmentProb, 0),
        alt.score.toFixed(3),
      ]);
    }
    console.log(table.toString());

    // Rationale (2-3 lines).
    for (const line of primary.rationale) {
      console.log(`    ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section 2: Roll Alerts
// ---------------------------------------------------------------------------

function printRollAlerts(rolls: readonly RollRecommendation[]): void {
  printHeader('2. ROLL ALERTS');
  if (rolls.length === 0) {
    console.log('(no positions hitting roll triggers)');
    return;
  }

  for (const r of rolls) {
    console.log(`\n  ${r.symbol} — ${r.relatedPositionId}`);
    console.log(`  >> Roll to $${r.contract.strike.toFixed(2)} ${r.expiration} (${r.contract.dte}d) for ${money(r.netCredit)} net credit`);

    console.log('  Triggers:');
    for (const t of r.triggers) {
      console.log(`    [${t.label}] ${t.message}`);
    }
    for (const line of r.rationale.slice(1)) {
      console.log(`    ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section 3: CSP Ideas
// ---------------------------------------------------------------------------

function printCspIdeas(
  csps: readonly SellCashSecuredPutRecommendation[],
  cashAvailable: number,
): void {
  printHeader('3. CSP IDEAS');
  if (csps.length === 0) {
    console.log('(no CSP candidates — cash or filters too tight)');
    return;
  }

  console.log(`  Cash available: ${money(cashAvailable)}\n`);
  const grouped = groupBy(csps, (r) => r.symbol);

  for (const [symbol, recs] of grouped) {
    const primary = recs[0]!;
    const alt = recs[1];

    console.log(`  ${symbol}  spot $${primary.currentPrice.toFixed(2)}`);
    console.log(`  >> Sell ${symbol} $${primary.contract.strike.toFixed(2)}P ${primary.expiration} (${primary.contract.dte}d) — ${money(primary.premium)}/c`);

    const table = new Table({
      head: ['', 'Strike', 'Exp', 'DTE', 'Prem/c', 'Cash/c', 'Cycle%', 'Disc%', 'P(asgn)', 'Score'],
      colAligns: ['left', 'right', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      style: { head: ['green'] },
    });

    table.push([
      'Primary',
      money(primary.contract.strike, 2),
      primary.expiration,
      String(primary.contract.dte),
      money(primary.premium, 0),
      money(primary.cashRequired, 0),
      pct(primary.cycleYield, 2),
      pct(primary.upsidePct, 1),
      pct(primary.assignmentProb, 0),
      primary.score.toFixed(3),
    ]);

    if (alt) {
      table.push([
        'Alt',
        money(alt.contract.strike, 2),
        alt.expiration,
        String(alt.contract.dte),
        money(alt.premium, 0),
        money(alt.cashRequired, 0),
        pct(alt.cycleYield, 2),
        pct(alt.upsidePct, 1),
        pct(alt.assignmentProb, 0),
        alt.score.toFixed(3),
      ]);
    }
    console.log(table.toString());

    for (const line of primary.rationale) {
      console.log(`    ${line}`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Section 4: Income Summary
// ---------------------------------------------------------------------------

function printIncomeSummary(
  portfolio: {
    closedTrades: readonly { netPremium: number }[];
    options: readonly { side: string; openPrice: number; contracts: number }[];
  },
  ccs: readonly SellCoveredCallRecommendation[],
  csps: readonly SellCashSecuredPutRecommendation[],
): void {
  printHeader('4. INCOME SUMMARY');
  const captured = portfolio.closedTrades.reduce((s, t) => s + t.netPremium, 0);
  const openRisk = portfolio.options.reduce(
    (s, o) => (o.side === 'SHORT' ? s + o.openPrice * 100 * o.contracts : s), 0,
  );
  // Only count primaries (index 0 per ticker group) for projections.
  const grouped = groupBy(ccs, (r) => r.symbol);
  let projectedCc = 0;
  for (const [, recs] of grouped) {
    if (recs[0]) projectedCc += recs[0].totalPremium;
  }
  const cspGrouped = groupBy(csps, (r) => r.symbol);
  let projectedCsp = 0;
  for (const [, recs] of cspGrouped) {
    if (recs[0]) projectedCsp += recs[0].premium;
  }

  const table = new Table({
    head: ['Metric', 'Amount'],
    colAligns: ['left', 'right'],
  });
  table.push(
    ['Premium captured (closed trades)', money(captured)],
    ['Open premium at risk', money(openRisk)],
    ['Projected CC income (primary picks)', money(projectedCc)],
    ['Projected CSP income (primary picks)', money(projectedCsp)],
    ['Total projected this cycle', money(projectedCc + projectedCsp)],
  );
  console.log(table.toString());
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

function dedupeRecs<R extends Recommendation>(recs: readonly R[]): readonly R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of recs) {
    const key = `${r.symbol}|${r.action}|${r.contract.strike}|${r.expiration}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const cfg = loadConfig();

  const ccs = dedupeRecs(
    generateCoveredCallRecommendations(
      cfg.portfolio, cfg.chains, cfg.settings, cfg.overrides,
    ),
  );
  const csps = dedupeRecs(
    generateCashSecuredPutRecommendations(
      cfg.portfolio.watchlist, cfg.portfolio.cash, cfg.chains, cfg.settings, cfg.overrides,
    ),
  );
  const rolls = generateRollRecommendations(
    cfg.portfolio.options, cfg.chains, cfg.settings, cfg.overrides,
  );

  console.log(`Flywheel — ${cfg.evaluationDate} | mode: ${cfg.settings.strategyMode}`);
  console.log(
    `Holdings: ${cfg.portfolio.stocks.map((s) => `${s.symbol} x${s.shares}`).join(', ')} | Cash: ${money(cfg.portfolio.cash)}`,
  );

  printCoveredCalls(ccs, cfg);
  printRollAlerts(rolls);
  printCspIdeas(csps, cfg.portfolio.cash);
  printIncomeSummary(cfg.portfolio, ccs, csps);
  console.log('');
}

main();
