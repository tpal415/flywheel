import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/loader.js';

describe('config loader', () => {
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

  it('loads roll settings', () => {
    const cfg = loadConfig();
    expect(cfg.settings.roll.deltaThreshold).toBeGreaterThan(0);
    expect(cfg.settings.roll.profitCapturePct).toBeGreaterThan(0);
  });

  it('loads assignment preferences from overrides', () => {
    const cfg = loadConfig();
    const tsla = cfg.overrides.find((o) => o.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.assignmentPreference).toBe('avoid');
    expect(tsla!.compounder).toBe(true);
  });

  it('is deterministic', () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(b.evaluationDate).toEqual(a.evaluationDate);
    expect(b.portfolio).toEqual(a.portfolio);
    expect(b.settings).toEqual(a.settings);
    expect(b.overrides).toEqual(a.overrides);
    expect([...b.chains.entries()]).toEqual([...a.chains.entries()]);
  });
});
