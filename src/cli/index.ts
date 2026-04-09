#!/usr/bin/env node
/**
 * CLI harness for the wheel copilot core engine.
 *
 * Run with `npm run cli`. Prints four sections:
 *   1. COVERED CALLS  — top 3 CC recs per held ticker, grouped by symbol
 *   2. ROLL ALERTS    — open positions hitting a roll trigger
 *   3. CSP IDEAS      — cash-secured put candidates (separate from CCs)
 *   4. INCOME SUMMARY — captured + projected premium dollars
 *
 * No broker calls. No network. No state. Reads from config/ JSON files.
 */

import Table from 'cli-table3';
import { loadConfig } from '../config/index.js';
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

/** Group an array by a key function, preserving insertion order. */
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

// ---------------------------------------------------------------------------
// Section 1: Covered Calls
// ---------------------------------------------------------------------------

function printCoveredCalls(
  ccs: readonly SellCoveredCallRecommendation[],
): void {
  printHeader('1. COVERED CALLS');
  if (ccs.length === 0) {
    console.log('(no covered call candidates matched current filters)');
    return;
  }

  const grouped = groupBy(ccs, (r) => r.symbol);

  for (const [symbol, recs] of grouped) {
    const first = recs[0]!;
    console.log(
      `\n  ${symbol}  (spot $${first.currentPrice.toFixed(2)}, ${first.contractsAvailable} contracts available)`,
    );

    const table = new Table({
      head: [
        '#',
        'Strike',
        'Exp',
        'DTE',
        'Style',
        'Prem/c',
        'Total',
        'Cycle%',
        'Ann%',
        'Upside%',
        'P(asgn)',
        'Score',
      ],
      colAligns: [
        'right',
        'right',
        'left',
        'right',
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
      ],
      style: { head: ['cyan'] },
    });

    recs.forEach((r, i) => {
      table.push([
        String(i + 1),
        money(r.contract.strike, 2),
        r.expiration,
        String(r.contract.dte),
        r.styleTag,
        money(r.premium, 0),
        money(r.totalPremium, 0),
        pct(r.cycleYield, 2),
        pct(r.annualizedYield, 1),
        pct(r.upsidePct, 1),
        pct(r.assignmentProb, 0),
        r.score.toFixed(3),
      ]);
    });
    console.log(table.toString());

    // Rationale for the top pick.
    const top = recs[0]!;
    console.log(`  Top pick rationale:`);
    for (const line of top.rationale) {
      console.log(`    - ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Section 2: Roll Alerts
// ---------------------------------------------------------------------------

function printRollAlerts(rolls: readonly RollRecommendation[]): void {
  printHeader('2. ROLL ALERTS');
  if (rolls.length === 0) {
    console.log('(no open positions are hitting roll triggers)');
    return;
  }

  for (const r of rolls) {
    console.log(
      `\n  ${r.symbol} — position ${r.relatedPositionId}`,
    );

    const table = new Table({
      head: [
        'Current',
        'Roll To',
        'New Exp',
        'DTE',
        'Net Credit',
        'New Delta',
        'Style',
        'Score',
      ],
      colAligns: [
        'left',
        'right',
        'left',
        'right',
        'right',
        'right',
        'left',
        'right',
      ],
      style: { head: ['yellow'] },
    });

    table.push([
      `$${r.triggers.length > 0 ? r.relatedPositionId.split('-').slice(2).join(' ').toUpperCase() : ''}`,
      money(r.contract.strike, 2),
      r.expiration,
      String(r.contract.dte),
      money(r.netCredit, 0),
      r.contract.delta.toFixed(2),
      r.styleTag,
      r.score.toFixed(3),
    ]);
    console.log(table.toString());

    // Print each trigger that fired.
    console.log('  Triggers:');
    for (const t of r.triggers) {
      console.log(`    [${t.label}] ${t.message}`);
    }

    // Rationale.
    console.log('  Action:');
    for (const line of r.rationale.slice(1)) {
      console.log(`    - ${line}`);
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
    console.log('(no cash-secured put candidates matched current filters)');
    return;
  }

  console.log(`  Cash available: ${money(cashAvailable)}\n`);

  const grouped = groupBy(csps, (r) => r.symbol);

  for (const [symbol, recs] of grouped) {
    const first = recs[0]!;
    console.log(
      `  ${symbol}  (spot $${first.currentPrice.toFixed(2)})`,
    );

    const table = new Table({
      head: [
        '#',
        'Strike',
        'Exp',
        'DTE',
        'Style',
        'Prem/c',
        'Cash/c',
        'Ctrs',
        'Cycle%',
        'Ann%',
        'Discount%',
        'P(asgn)',
        'Score',
      ],
      colAligns: [
        'right',
        'right',
        'left',
        'right',
        'left',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
        'right',
      ],
      style: { head: ['green'] },
    });

    recs.forEach((r, i) => {
      table.push([
        String(i + 1),
        money(r.contract.strike, 2),
        r.expiration,
        String(r.contract.dte),
        r.styleTag,
        money(r.premium, 0),
        money(r.cashRequired, 0),
        String(r.contractsAvailable),
        pct(r.cycleYield, 2),
        pct(r.annualizedYield, 1),
        pct(r.upsidePct, 1),
        pct(r.assignmentProb, 0),
        r.score.toFixed(3),
      ]);
    });
    console.log(table.toString());

    const top = recs[0]!;
    console.log(`  Top pick rationale:`);
    for (const line of top.rationale) {
      console.log(`    - ${line}`);
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
    options: readonly {
      side: string;
      openPrice: number;
      contracts: number;
    }[];
  },
  ccs: readonly SellCoveredCallRecommendation[],
  csps: readonly SellCashSecuredPutRecommendation[],
): void {
  printHeader('4. INCOME SUMMARY');
  const captured = portfolio.closedTrades.reduce(
    (s, t) => s + t.netPremium,
    0,
  );
  const openRisk = portfolio.options.reduce(
    (s, o) =>
      o.side === 'SHORT' ? s + o.openPrice * 100 * o.contracts : s,
    0,
  );
  const projectedCc = ccs.reduce((s, r) => s + r.totalPremium, 0);
  const projectedCsp = csps.reduce((s, r) => s + r.premium, 0);

  const table = new Table({
    head: ['Metric', 'Amount'],
    colAligns: ['left', 'right'],
  });
  table.push(
    ['Premium captured (closed trades)', money(captured)],
    ['Open premium at risk (collected)', money(openRisk)],
    ['Projected CC premium (all tickers, top picks)', money(projectedCc)],
    ['Projected CSP premium (top picks, 1 contract each)', money(projectedCsp)],
    ['Total projected this cycle', money(projectedCc + projectedCsp)],
  );
  console.log(table.toString());
}

// ---------------------------------------------------------------------------
// Dedup helper
// ---------------------------------------------------------------------------

function dedupeRecs<R extends Recommendation>(
  recs: readonly R[],
): readonly R[] {
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
      cfg.portfolio,
      cfg.chains,
      cfg.settings,
      cfg.overrides,
    ),
  );
  const csps = dedupeRecs(
    generateCashSecuredPutRecommendations(
      cfg.portfolio.watchlist,
      cfg.portfolio.cash,
      cfg.chains,
      cfg.settings,
      cfg.overrides,
    ),
  );
  const rolls = generateRollRecommendations(
    cfg.portfolio.options,
    cfg.chains,
    cfg.settings,
    cfg.overrides,
  );

  console.log(`Flywheel Wheel Copilot — ${cfg.evaluationDate}`);
  console.log(`Cash: ${money(cfg.portfolio.cash)}`);
  console.log(
    `Holdings: ${cfg.portfolio.stocks.map((s) => `${s.symbol} x${s.shares} @ $${s.currentPrice.toFixed(2)}`).join(', ')}`,
  );
  console.log(
    `Config: config/holdings.json, config/market.json, config/settings.json`,
  );

  printCoveredCalls(ccs);
  printRollAlerts(rolls);
  printCspIdeas(csps, cfg.portfolio.cash);
  printIncomeSummary(cfg.portfolio, ccs, csps);
  console.log('');
}

main();
