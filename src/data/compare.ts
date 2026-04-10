/**
 * Compare mock vs real market data side-by-side.
 *
 * Runs both providers for the same symbol set and prints a table showing
 * price differences, chain coverage, and how recommendations diverge.
 */

import Table from 'cli-table3';
import type { OptionChain } from '../types/chains.js';
import type { MarketSnapshot } from './types.js';

function money(x: number, d = 2): string {
  return `$${x.toFixed(d)}`;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

export interface ComparisonResult {
  readonly symbol: string;
  readonly mockPrice: number | undefined;
  readonly realPrice: number | undefined;
  readonly priceDiffPct: number | undefined;
  readonly mockExpirations: number;
  readonly realExpirations: number;
  readonly mockStrikes: number;
  readonly realStrikes: number;
}

export function buildComparison(
  mockSnap: MarketSnapshot,
  realSnap: MarketSnapshot,
  symbols: readonly string[],
): readonly ComparisonResult[] {
  return symbols.map((sym) => {
    const mp = mockSnap.prices.get(sym);
    const rp = realSnap.prices.get(sym);
    const mc = mockSnap.chains.get(sym);
    const rc = realSnap.chains.get(sym);

    return {
      symbol: sym,
      mockPrice: mp,
      realPrice: rp,
      priceDiffPct:
        mp !== undefined && rp !== undefined && mp > 0
          ? (rp - mp) / mp
          : undefined,
      mockExpirations: mc?.expirations.length ?? 0,
      realExpirations: rc?.expirations.length ?? 0,
      mockStrikes: countStrikes(mc),
      realStrikes: countStrikes(rc),
    };
  });
}

function countStrikes(chain: OptionChain | undefined): number {
  if (!chain) return 0;
  let n = 0;
  for (const slice of chain.expirations) {
    n += slice.calls.length + slice.puts.length;
  }
  return n;
}

export function printComparison(
  results: readonly ComparisonResult[],
  mockSnap: MarketSnapshot,
  realSnap: MarketSnapshot,
): void {
  console.log('\n=====================');
  console.log('  DATA COMPARISON');
  console.log('=====================');
  console.log(`  Mock: ${mockSnap.source}`);
  console.log(`  Real: ${realSnap.source} @ ${realSnap.timestamp}`);

  if (realSnap.warnings.length > 0) {
    console.log('  Real data warnings:');
    for (const w of realSnap.warnings) {
      console.log(`    - ${w}`);
    }
  }

  const table = new Table({
    head: [
      'Symbol',
      'Mock Price',
      'Real Price',
      'Diff%',
      'Mock Exp',
      'Real Exp',
      'Mock Strikes',
      'Real Strikes',
      'Status',
    ],
    colAligns: [
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'left',
    ],
  });

  for (const r of results) {
    const status = getStatus(r);
    table.push([
      r.symbol,
      r.mockPrice !== undefined ? money(r.mockPrice) : '—',
      r.realPrice !== undefined ? money(r.realPrice) : '—',
      r.priceDiffPct !== undefined ? pct(r.priceDiffPct) : '—',
      String(r.mockExpirations),
      String(r.realExpirations),
      String(r.mockStrikes),
      String(r.realStrikes),
      status,
    ]);
  }
  console.log(table.toString());

  // Summary.
  const withReal = results.filter((r) => r.realPrice !== undefined);
  const withChains = results.filter((r) => r.realExpirations > 0);
  console.log(
    `\n  ${withReal.length}/${results.length} symbols have real prices, ${withChains.length}/${results.length} have real chains.`,
  );
  if (withReal.length > 0) {
    const avgDiff =
      withReal.reduce(
        (sum, r) => sum + Math.abs(r.priceDiffPct ?? 0),
        0,
      ) / withReal.length;
    console.log(`  Average |price diff|: ${pct(avgDiff)}`);
  }
}

function getStatus(r: ComparisonResult): string {
  if (r.realPrice === undefined) return 'NO DATA';
  if (r.realExpirations === 0) return 'NO CHAIN';
  if (
    r.priceDiffPct !== undefined &&
    Math.abs(r.priceDiffPct) > 0.05
  ) {
    return 'STALE MOCK';
  }
  return 'OK';
}
