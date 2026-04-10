import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/data/mock.js';
import { createProvider, buildComparison } from '../src/data/index.js';
import type { MarketSnapshot } from '../src/data/types.js';

describe('MockProvider', () => {
  it('returns mock mode and synthetic source', async () => {
    const provider = new MockProvider();
    const snap = await provider.getMarketData(['TSLA', 'MSFT'], 0.045);
    expect(snap.mode).toBe('mock');
    expect(snap.source).toContain('synthetic');
    expect(snap.timestamp).toBeTruthy();
    expect(snap.warnings).toHaveLength(0);
  });

  it('returns prices and chains for known symbols', async () => {
    const provider = new MockProvider();
    const snap = await provider.getMarketData(
      ['TSLA', 'PLTR', 'IREN'],
      0.045,
    );
    expect(snap.prices.size).toBe(3);
    expect(snap.chains.size).toBe(3);
    for (const sym of ['TSLA', 'PLTR', 'IREN']) {
      expect(snap.prices.get(sym)).toBeGreaterThan(0);
      const chain = snap.chains.get(sym);
      expect(chain).toBeDefined();
      expect(chain!.expirations.length).toBeGreaterThan(0);
    }
  });

  it('skips unknown symbols gracefully', async () => {
    const provider = new MockProvider();
    const snap = await provider.getMarketData(['TSLA', 'FAKESYM'], 0.045);
    expect(snap.prices.has('TSLA')).toBe(true);
    expect(snap.prices.has('FAKESYM')).toBe(false);
  });

  it('is deterministic', async () => {
    const provider = new MockProvider();
    const a = await provider.getMarketData(['TSLA'], 0.045);
    const b = await provider.getMarketData(['TSLA'], 0.045);
    expect([...a.chains.entries()]).toEqual([...b.chains.entries()]);
    expect([...a.prices.entries()]).toEqual([...b.prices.entries()]);
  });
});

describe('MockProvider per-symbol methods', () => {
  it('getSpotPrice returns price for known symbol', async () => {
    const p = new MockProvider();
    const price = await p.getSpotPrice('TSLA');
    expect(price).toBe(240);
  });

  it('getSpotPrice returns undefined for unknown symbol', async () => {
    const p = new MockProvider();
    const price = await p.getSpotPrice('FAKESYM');
    expect(price).toBeUndefined();
  });

  it('getOptionChain returns chain for known symbol', async () => {
    const p = new MockProvider();
    const chain = await p.getOptionChain('TSLA', 0.045);
    expect(chain).toBeDefined();
    expect(chain!.symbol).toBe('TSLA');
    expect(chain!.underlyingPrice).toBe(240);
    expect(chain!.expirations.length).toBeGreaterThan(0);
  });

  it('getOptionChain returns undefined for unknown symbol', async () => {
    const p = new MockProvider();
    const chain = await p.getOptionChain('FAKESYM', 0.045);
    expect(chain).toBeUndefined();
  });
});

describe('createProvider', () => {
  it('returns MockProvider for "mock"', () => {
    const p = createProvider('mock');
    expect(p).toBeInstanceOf(MockProvider);
  });

  it('returns MockProvider for "real" when no Polygon API key', () => {
    // Without POLYGON_API_KEY, createProvider('real') falls back to MockProvider.
    delete process.env['POLYGON_API_KEY'];
    const p = createProvider('real');
    expect(p).toBeInstanceOf(MockProvider);
  });
});

describe('buildComparison', () => {
  it('computes price diffs and coverage', async () => {
    const mockSnap: MarketSnapshot = {
      prices: new Map([['TSLA', 240], ['AMD', 180]]),
      chains: new Map(),
      mode: 'mock',
      timestamp: '',
      source: 'mock',
      warnings: [],
    };
    const realSnap: MarketSnapshot = {
      prices: new Map([['TSLA', 250]]),
      chains: new Map(),
      mode: 'real',
      timestamp: '',
      source: 'real',
      warnings: [],
    };
    const results = buildComparison(mockSnap, realSnap, ['TSLA', 'AMD']);
    expect(results).toHaveLength(2);

    const tsla = results.find((r) => r.symbol === 'TSLA')!;
    expect(tsla.mockPrice).toBe(240);
    expect(tsla.realPrice).toBe(250);
    expect(tsla.priceDiffPct).toBeCloseTo(10 / 240, 6);

    const amd = results.find((r) => r.symbol === 'AMD')!;
    expect(amd.realPrice).toBeUndefined();
    expect(amd.priceDiffPct).toBeUndefined();
  });
});
