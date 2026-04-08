#!/usr/bin/env node
/**
 * CLI harness for the wheel copilot core engine.
 *
 * Run with `npm run cli`. Prints three sections:
 *   1. NEXT CYCLE SETUP — best CC + CSP recs across the portfolio
 *   2. ROLL ALERTS      — open positions hitting a roll trigger
 *   3. INCOME SUMMARY   — captured + projected premium dollars
 *
 * No broker calls. No network. No state. Runs entirely off fixtures.
 */

import Table from 'cli-table3';
import {
  generateCashSecuredPutRecommendations,
  generateCoveredCallRecommendations,
  generateRollRecommendations,
} from '../engine/index.js';
import {
  DEMO_OVERRIDES,
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  EVAL_DATE,
  buildDemoChains,
} from '../fixtures/index.js';
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

function nextCycleTable(
  ccs: readonly SellCoveredCallRecommendation[],
  csps: readonly SellCashSecuredPutRecommendation[],
): void {
  printHeader('1. NEXT CYCLE SETUP');
  const combined: readonly (
    | SellCoveredCallRecommendation
    | SellCashSecuredPutRecommendation
  )[] = [...ccs, ...csps].sort(
    (a, b) => b.annualizedYield - a.annualizedYield,
  );

  const table = new Table({
    head: [
      'Symbol',
      'Action',
      'Strike',
      'Exp',
      'DTE',
      'Premium',
      'Yield%',
      'AssignProb',
      'Score',
    ],
    colAligns: [
      'left',
      'left',
      'right',
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
    ],
  });

  if (combined.length === 0) {
    console.log('(no recommendations matched current filters)');
    return;
  }
  for (const r of combined) {
    table.push([
      r.symbol,
      r.action,
      money(r.contract.strike, 2),
      r.expiration,
      String(r.contract.dte),
      money(r.premium, 0),
      pct(r.annualizedYield, 1),
      pct(r.assignmentProb, 0),
      r.score.toFixed(3),
    ]);
  }
  console.log(table.toString());
}

function rollTable(rolls: readonly RollRecommendation[]): void {
  printHeader('2. ROLL ALERTS');
  if (rolls.length === 0) {
    console.log('(no open positions are currently hitting roll triggers)');
    return;
  }
  const table = new Table({
    head: [
      'Symbol',
      'Position',
      'New Strike',
      'New Exp',
      'DTE',
      'Net Credit',
      'New Delta',
      'Score',
    ],
    colAligns: [
      'left',
      'left',
      'right',
      'left',
      'right',
      'right',
      'right',
      'right',
    ],
  });
  for (const r of rolls) {
    table.push([
      r.symbol,
      r.relatedPositionId,
      money(r.contract.strike, 2),
      r.expiration,
      String(r.contract.dte),
      money(r.netCredit, 0),
      r.contract.delta.toFixed(2),
      r.score.toFixed(3),
    ]);
  }
  console.log(table.toString());
  console.log('\nRationale:');
  for (const r of rolls) {
    console.log(`  [${r.symbol} ${r.relatedPositionId}]`);
    for (const line of r.rationale) console.log(`    - ${line}`);
  }
}

function incomeTable(
  ccs: readonly SellCoveredCallRecommendation[],
  csps: readonly SellCashSecuredPutRecommendation[],
): void {
  printHeader('3. INCOME SUMMARY');
  const captured = DEMO_PORTFOLIO.closedTrades.reduce(
    (s, t) => s + t.netPremium,
    0,
  );
  const openRisk = DEMO_PORTFOLIO.options.reduce(
    (s, o) =>
      o.side === 'SHORT' ? s + o.openPrice * 100 * o.contracts : s,
    0,
  );
  const projectedCc = ccs.reduce((s, r) => s + r.premium, 0);
  const projectedCsp = csps.reduce((s, r) => s + r.premium, 0);

  const table = new Table({
    head: ['Metric', 'Amount'],
    colAligns: ['left', 'right'],
  });
  table.push(
    ['Premium captured (closed trades)', money(captured)],
    ['Open premium at risk (collected)', money(openRisk)],
    ['Projected CC premium (if all taken)', money(projectedCc)],
    ['Projected CSP premium (if all taken)', money(projectedCsp)],
    ['Total projected this cycle', money(projectedCc + projectedCsp)],
  );
  console.log(table.toString());
}

function dedupeRecs<R extends Recommendation>(
  recs: readonly R[],
): readonly R[] {
  // Stable de-dupe: same symbol + strike + expiration + action counts once.
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

function main(): void {
  const chains = buildDemoChains();
  const ccs = dedupeRecs(
    generateCoveredCallRecommendations(
      DEMO_PORTFOLIO,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    ),
  );
  const csps = dedupeRecs(
    generateCashSecuredPutRecommendations(
      DEMO_PORTFOLIO.watchlist,
      DEMO_PORTFOLIO.cash,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    ),
  );
  const rolls = generateRollRecommendations(
    DEMO_PORTFOLIO.options,
    chains,
    DEMO_SETTINGS,
  );

  console.log(`Flywheel Wheel Copilot — evaluation date ${EVAL_DATE}`);
  console.log(`Portfolio cash: ${money(DEMO_PORTFOLIO.cash)}`);
  console.log(
    `Stocks: ${DEMO_PORTFOLIO.stocks.map((s) => `${s.symbol} x${s.shares}`).join(', ')}`,
  );

  nextCycleTable(ccs, csps);
  rollTable(rolls);
  incomeTable(ccs, csps);
  console.log('');
}

main();
