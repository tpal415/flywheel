#!/usr/bin/env node
/**
 * CLI harness — personalized wheel copilot.
 *
 * Usage:
 *   npm run cli                  # mock data (default, offline)
 *   npm run cli -- --data=real   # live Polygon.io data
 *   npm run cli -- --data=mock   # explicit mock
 *   npm run cli -- --compare     # run both mock + real, show diff table
 *   npm run cli -- --html [path] # also write an HTML report to disk
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Table from 'cli-table3';
import {
  loadConfig,
  loadConfigWithData,
  validateConfigFiles,
  type LoadedConfig,
} from '../config/index.js';
import {
  createProvider,
  buildComparison,
  printComparison,
  type DataMode,
} from '../data/index.js';
import {
  generateCashSecuredPutRecommendations,
  generateCoveredCallRecommendations,
  generateRollRecommendations,
} from '../engine/index.js';
import {
  renderHtmlReport,
  type DataProvenance,
  type IncomeSummary,
} from './renderers/html.js';
import type {
  Recommendation,
  RollRecommendation,
  SellCashSecuredPutRecommendation,
  SellCoveredCallRecommendation,
} from '../types/recommendations.js';
import { effectiveSettings, type TickerOverride } from '../types/settings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function groupBy<T>(
  arr: readonly T[],
  key: (t: T) => string,
): Map<string, T[]> {
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
    case 'avoid':
      return 'AVOID assignment';
    case 'prefer':
      return 'OK to assign';
    default:
      return 'neutral';
  }
}

interface CliFlags {
  data: DataMode;
  compare: boolean;
  validate: boolean;
  /** undefined = no HTML report; string = path (empty string = auto-generate). */
  htmlPath: string | undefined;
}

function parseFlags(): CliFlags {
  const args = process.argv;
  const compare = args.includes('--compare');
  const validate = args.includes('--validate');

  // Support --data=, --mode= (legacy), and bare --real as shorthand.
  const dataArg =
    args.find((a) => a.startsWith('--data=')) ??
    args.find((a) => a.startsWith('--mode='));

  let data: DataMode = 'mock';
  if (dataArg) {
    const val = dataArg.split('=')[1];
    if (val === 'real' || val === 'mock') {
      data = val;
    } else {
      console.error(`Unknown data mode "${val}", using mock.`);
    }
  } else if (args.includes('--real')) {
    data = 'real';
  } else if (args.includes('--mock')) {
    data = 'mock';
  }

  // --html can take either the next positional as a path, or no arg.
  // Supports: --html, --html=path, --html path
  let htmlPath: string | undefined;
  const htmlEq = args.find((a) => a.startsWith('--html='));
  if (htmlEq) {
    htmlPath = htmlEq.split('=').slice(1).join('=');
  } else {
    const idx = args.indexOf('--html');
    if (idx >= 0) {
      const next = args[idx + 1];
      // Treat the next token as a path only if it's not another flag.
      htmlPath = next && !next.startsWith('--') ? next : '';
    }
  }

  return { data, compare, validate, htmlPath };
}

function defaultHtmlPath(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return join('out', `report-${stamp}.html`);
}

// ---------------------------------------------------------------------------
// Run recommendations and print output for a given config
// ---------------------------------------------------------------------------

function runAndPrint(cfg: LoadedConfig, htmlPath: string | undefined): void {
  const ds = cfg.dataSource;
  const modeTag = ds?.mode === 'real' ? 'REAL' : 'MOCK';

  // Safety banner for real-data mode.
  if (ds?.mode === 'real') {
    console.log('========================================');
    console.log('  LIVE MARKET DATA — INFORMATIONAL ONLY');
    console.log('========================================');
    console.log('  Recommendations are NOT trade orders.');
    console.log('  Verify every number against your broker');
    console.log('  before placing any trades.');
    console.log('========================================\n');
  }

  console.log(
    `Flywheel — ${cfg.evaluationDate} | mode: ${cfg.settings.strategyMode} | data: ${modeTag}`,
  );
  if (ds) {
    console.log(`Source: ${ds.source} @ ${ds.timestamp}`);
  }
  console.log(
    `Holdings: ${cfg.portfolio.stocks.map((s) => `${s.symbol} x${s.shares}`).join(', ')} | Cash: ${money(cfg.portfolio.cash)}`,
  );
  if (ds && ds.warnings.length > 0) {
    console.log('Data warnings:');
    for (const w of ds.warnings) {
      console.log(`  - ${w}`);
    }
  }

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

  printCoveredCalls(ccs, cfg);
  printRollAlerts(rolls);
  printCspIdeas(csps, cfg.portfolio.cash);
  printIncomeSummary(cfg.portfolio, ccs, csps);

  if (htmlPath !== undefined) {
    writeHtmlReport({
      htmlPath,
      cfg,
      ccs: [...ccs],
      csps: [...csps],
      rolls: [...rolls],
    });
  }

  console.log('');
}

/**
 * Build an IncomeSummary from the same numbers the CLI table prints.
 * Keeps the engine outputs and the renderer outputs in sync.
 */
function buildIncomeSummary(
  portfolio: {
    closedTrades: readonly { netPremium: number }[];
    options: readonly { side: string; openPrice: number; contracts: number }[];
  },
  ccs: readonly SellCoveredCallRecommendation[],
  csps: readonly SellCashSecuredPutRecommendation[],
): IncomeSummary {
  const captured = portfolio.closedTrades.reduce(
    (s, t) => s + t.netPremium,
    0,
  );
  const atRisk = portfolio.options.reduce(
    (s, o) =>
      o.side === 'SHORT' ? s + o.openPrice * 100 * o.contracts : s,
    0,
  );
  const ccGrouped = groupBy(ccs, (r) => r.symbol);
  let projectedCC = 0;
  for (const [, recs] of ccGrouped) {
    if (recs[0]) projectedCC += recs[0].totalPremium;
  }
  const cspGrouped = groupBy(csps, (r) => r.symbol);
  let projectedCSP = 0;
  for (const [, recs] of cspGrouped) {
    if (recs[0]) projectedCSP += recs[0].premium;
  }
  return {
    captured,
    atRisk,
    projectedCC,
    projectedCSP,
    total: projectedCC + projectedCSP,
  };
}

/**
 * Classify each held + watchlist symbol into polygon/fallback/mock.
 * `polygon` means the symbol had a real chain in the snapshot,
 * `fallback` means synthetic chain was used even though real mode is on,
 * `mock` means mock mode.
 */
function buildProvenance(cfg: LoadedConfig): readonly DataProvenance[] {
  const ds = cfg.dataSource;
  const symbols = [
    ...cfg.portfolio.stocks.map((s) => s.symbol),
    ...cfg.portfolio.watchlist,
  ];
  const unique = [...new Set(symbols)].sort();
  const warningsBySymbol = new Map<string, string>();
  if (ds) {
    for (const w of ds.warnings) {
      const m = w.match(/^([A-Z.]+):\s*(.+)$/);
      if (m && m[1] && m[2]) warningsBySymbol.set(m[1], m[2]);
    }
  }

  return unique.map((sym) => {
    if (!ds || ds.mode === 'mock') {
      return { symbol: sym, source: 'mock' as const };
    }
    const warning = warningsBySymbol.get(sym);
    if (warning) {
      return { symbol: sym, source: 'fallback' as const, note: warning };
    }
    return { symbol: sym, source: 'polygon' as const };
  });
}

function writeHtmlReport(args: {
  htmlPath: string;
  cfg: LoadedConfig;
  ccs: readonly SellCoveredCallRecommendation[];
  csps: readonly SellCashSecuredPutRecommendation[];
  rolls: readonly RollRecommendation[];
}): void {
  const { htmlPath, cfg, ccs, csps, rolls } = args;
  const now = new Date();
  const path =
    htmlPath === '' ? defaultHtmlPath(now) : htmlPath;

  const mode = cfg.dataSource?.mode === 'real' ? 'real' : 'demo';
  const recommendations = [...ccs, ...csps];
  const incomeSummary = buildIncomeSummary(cfg.portfolio, ccs, csps);
  const provenance = mode === 'real' ? buildProvenance(cfg) : undefined;

  const html = renderHtmlReport({
    generatedAt: now,
    mode,
    recommendations,
    rollAlerts: rolls,
    incomeSummary,
    ...(provenance !== undefined && { provenance }),
  });

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf-8');
    console.log(`\nHTML report written to ${path}`);
  } catch (e: unknown) {
    console.error(
      `Failed to write HTML report: ${e instanceof Error ? e.message : String(e)}`,
    );
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
    const eff = effectiveSettings(
      cfg.settings,
      overrideBySymbol.get(symbol),
    );
    const stock = cfg.portfolio.stocks.find((s) => s.symbol === symbol)!;
    const gain = (
      ((primary.currentPrice - stock.avgCostBasis) / stock.avgCostBasis) *
      100
    ).toFixed(1);

    console.log(
      `\n  ${symbol}  spot $${primary.currentPrice.toFixed(2)} | cost $${stock.avgCostBasis.toFixed(2)} (${Number(gain) >= 0 ? '+' : ''}${gain}%) | ${primary.contractsAvailable}x100 avail | ${prefLabel(eff.assignmentPreference)}${eff.compounder ? ' | compounder' : ''}`,
    );
    console.log(
      `  >> Sell ${primary.contractsAvailable}x ${symbol} $${primary.contract.strike.toFixed(2)}C ${primary.expiration} (${primary.contract.dte}d)`,
    );

    const table = new Table({
      head: [
        '',
        'Strike',
        'Exp',
        'DTE',
        'Prem/c',
        'Total',
        'Cycle%',
        'Upside%',
        'P(asgn)',
        'Score',
      ],
      colAligns: [
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

    if (primary.positionCapped) {
      console.log(`    ** Capped at ${primary.contractsAvailable} contracts (max per ticker). ${Math.floor(stock.shares / 100) - primary.contractsAvailable} contracts held back.`);
    }
    for (const line of primary.rationale) {
      console.log(`    ${line}`);
    }
    if (primary.warnings.length > 0) {
      for (const w of primary.warnings) {
        console.log(`    !! ${w}`);
      }
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
    console.log(
      `  >> Roll to $${r.contract.strike.toFixed(2)} ${r.expiration} (${r.contract.dte}d) for ${money(r.netCredit)} net credit`,
    );
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
    console.log(
      `  >> Sell ${symbol} $${primary.contract.strike.toFixed(2)}P ${primary.expiration} (${primary.contract.dte}d) — ${money(primary.premium)}/c`,
    );

    const table = new Table({
      head: [
        '',
        'Strike',
        'Exp',
        'DTE',
        'Prem/c',
        'Cash/c',
        'Cycle%',
        'Disc%',
        'P(asgn)',
        'Score',
      ],
      colAligns: [
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
    if (primary.warnings.length > 0) {
      for (const w of primary.warnings) {
        console.log(`    !! ${w}`);
      }
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
// Load config with the given data mode
// ---------------------------------------------------------------------------

async function loadForMode(mode: DataMode): Promise<LoadedConfig> {
  if (mode === 'real') {
    const provider = createProvider('real');
    const baseCfg = loadConfig();
    const allSymbols = [
      ...baseCfg.portfolio.stocks.map((s) => s.symbol),
      ...baseCfg.portfolio.watchlist,
    ];
    const snapshot = await provider.getMarketData(allSymbols, 0.045);
    return loadConfigWithData(snapshot);
  }
  return loadConfig();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseFlags();

  if (flags.validate) {
    console.log('Validating config files...\n');
    const errors = validateConfigFiles();
    if (errors.length === 0) {
      console.log('All config files are valid.');
    } else {
      console.error(`Found ${errors.length} error(s):`);
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    return;
  }

  if (flags.compare) {
    console.log('Running comparison: MOCK vs REAL...\n');

    const mockProvider = createProvider('mock');
    const realProvider = createProvider('real');
    const baseCfg = loadConfig();
    const allSymbols = [
      ...baseCfg.portfolio.stocks.map((s) => s.symbol),
      ...baseCfg.portfolio.watchlist,
    ];

    const [mockSnap, realSnap] = await Promise.all([
      mockProvider.getMarketData(allSymbols, 0.045),
      realProvider.getMarketData(allSymbols, 0.045),
    ]);

    const results = buildComparison(mockSnap, realSnap, allSymbols);
    printComparison(results, mockSnap, realSnap);

    // Also run recommendations with real data if we got any.
    const realSymsWithData = results.filter(
      (r) => r.realPrice !== undefined,
    ).length;
    if (realSymsWithData > 0) {
      console.log('\n--- Recommendations using REAL data ---');
      const realCfg = loadConfigWithData(realSnap);
      runAndPrint(realCfg, flags.htmlPath);
    } else {
      console.log(
        '\nNo real data available — showing MOCK recommendations.\n',
      );
      runAndPrint(baseCfg, flags.htmlPath);
    }
    return;
  }

  // Standard single-mode run.
  if (flags.data === 'real') {
    console.log('Fetching live market data...\n');
  }
  const cfg = await loadForMode(flags.data);
  runAndPrint(cfg, flags.htmlPath);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
