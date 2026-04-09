import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/loader.js';

describe('config loader', () => {
  it('loads all config files without error', () => {
    const cfg = loadConfig();
    expect(cfg.evaluationDate).toBe('2026-04-08');
    expect(cfg.portfolio.stocks.length).toBeGreaterThan(0);
    expect(cfg.portfolio.cash).toBeGreaterThan(0);
    expect(cfg.chains.size).toBeGreaterThan(0);
    expect(cfg.settings.targetDeltaRange).toHaveLength(2);
  });

  it('merges market prices into stock positions', () => {
    const cfg = loadConfig();
    for (const stock of cfg.portfolio.stocks) {
      expect(stock.currentPrice).toBeGreaterThan(0);
      expect(stock.avgCostBasis).toBeGreaterThan(0);
    }
  });

  it('generates chains for all held + watchlist symbols', () => {
    const cfg = loadConfig();
    const expected = [
      ...cfg.portfolio.stocks.map((s) => s.symbol),
      ...cfg.portfolio.watchlist,
    ];
    for (const sym of expected) {
      expect(cfg.chains.has(sym)).toBe(true);
    }
  });

  it('includes roll settings', () => {
    const cfg = loadConfig();
    expect(cfg.settings.roll.deltaThreshold).toBeGreaterThan(0);
    expect(cfg.settings.roll.profitCapturePct).toBeGreaterThan(0);
    expect(cfg.settings.roll.nearStrikePct).toBeGreaterThan(0);
    expect(cfg.settings.roll.minDte).toBeGreaterThan(0);
  });

  it('is deterministic across repeated loads', () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(b.evaluationDate).toEqual(a.evaluationDate);
    expect(b.portfolio).toEqual(a.portfolio);
    expect(b.settings).toEqual(a.settings);
    expect(b.overrides).toEqual(a.overrides);
    // Chains are Map objects; compare their serialized form.
    expect([...b.chains.entries()]).toEqual([...a.chains.entries()]);
  });
});
