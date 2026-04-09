import { describe, it, expect } from 'vitest';
import { loadConfig, loadConfigWithData } from '../src/config/loader.js';
import type { MarketSnapshot } from '../src/data/types.js';
import { MockProvider } from '../src/data/mock.js';

describe('loadConfig (mock)', () => {
  it('loads all config files', () => {
    const cfg = loadConfig();
    expect(cfg.evaluationDate).toBe('2026-04-08');
    expect(cfg.portfolio.stocks.length).toBeGreaterThan(0);
    expect(cfg.chains.size).toBeGreaterThan(0);
    expect(cfg.settings.strategyMode).toBe('balanced');
  });

  it('merges market prices into stocks', () => {
    const cfg = loadConfig();
    for (const s of cfg.portfolio.stocks) {
      expect(s.currentPrice).toBeGreaterThan(0);
    }
  });

  it('generates chains for all held + watchlist symbols', () => {
    const cfg = loadConfig();
    const expected = [
      ...cfg.portfolio.stocks.map((s) => s.symbol),
      ...cfg.portfolio.watchlist,
    ];
    for (const sym of expected) expect(cfg.chains.has(sym)).toBe(true);
  });

  it('loads assignment preferences from overrides', () => {
    const cfg = loadConfig();
    const tsla = cfg.overrides.find((o) => o.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.assignmentPreference).toBe('avoid');
    expect(tsla!.compounder).toBe(true);
  });

  it('includes dataSource metadata', () => {
    const cfg = loadConfig();
    expect(cfg.dataSource).toBeDefined();
    expect(cfg.dataSource!.mode).toBe('mock');
  });

  it('is deterministic', () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(b.portfolio).toEqual(a.portfolio);
    expect(b.settings).toEqual(a.settings);
    expect(b.overrides).toEqual(a.overrides);
    expect([...b.chains.entries()]).toEqual([...a.chains.entries()]);
  });
});

describe('loadConfigWithData', () => {
  it('uses snapshot prices over market.json prices', async () => {
    const provider = new MockProvider();
    const snap = await provider.getMarketData(['TSLA'], 0.045);

    // Build a snapshot with an overridden TSLA price.
    const modifiedPrices = new Map(snap.prices);
    modifiedPrices.set('TSLA', 999.99);
    const modifiedSnap: MarketSnapshot = { ...snap, prices: modifiedPrices };

    const cfg = loadConfigWithData(modifiedSnap);
    const tsla = cfg.portfolio.stocks.find((s) => s.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.currentPrice).toBe(999.99);
  });

  it('falls back to synthetic chains for missing symbols', async () => {
    // Snapshot with no chains at all — loader should use synthetic fallback.
    const snap: MarketSnapshot = {
      prices: new Map(),
      chains: new Map(),
      mode: 'real',
      timestamp: new Date().toISOString(),
      source: 'test',
      warnings: [],
    };
    const cfg = loadConfigWithData(snap);
    // TSLA should still get a chain from the market.json fallback.
    expect(cfg.chains.has('TSLA')).toBe(true);
  });
});
