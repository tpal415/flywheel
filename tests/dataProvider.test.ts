import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/data/mock.js';
import { createProvider } from '../src/data/index.js';

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
    // Chains should be identical (timestamps will differ).
    expect([...a.chains.entries()]).toEqual([...b.chains.entries()]);
    expect([...a.prices.entries()]).toEqual([...b.prices.entries()]);
  });
});

describe('createProvider', () => {
  it('returns MockProvider for "mock"', () => {
    const p = createProvider('mock');
    expect(p).toBeInstanceOf(MockProvider);
  });

  it('returns YahooProvider for "real"', async () => {
    const { YahooProvider } = await import('../src/data/yahoo.js');
    const p = createProvider('real');
    expect(p).toBeInstanceOf(YahooProvider);
  });
});
