import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MarketSnapshot } from '../src/data/types.js';

/**
 * PolygonProvider tests.
 *
 * Since Polygon requires an API key and network access, these tests mock
 * the global fetch to simulate API responses. This verifies our mapping
 * logic, pagination handling, and fallback behavior without hitting the
 * real API.
 */

// We need to set POLYGON_API_KEY before importing PolygonProvider.
beforeEach(() => {
  process.env['POLYGON_API_KEY'] = 'test-key';
});
afterEach(() => {
  delete process.env['POLYGON_API_KEY'];
  vi.restoreAllMocks();
});

async function importProvider() {
  // Dynamic import so env var is set first.
  const { PolygonProvider } = await import('../src/data/polygon.js');
  return new PolygonProvider();
}

function mockFetch(responses: Map<string, unknown>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    // Strip the apiKey param for matching.
    const base = url.replace(/[?&]apiKey=[^&]*/, '');
    for (const [pattern, body] of responses) {
      if (base.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ status: 'ERROR' }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PolygonProvider', () => {
  it('fetches spot price from /v2/aggs/ticker/.../prev', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/TSLA/prev',
        { status: 'OK', results: [{ c: 247.5 }] },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const price = await provider.getSpotPrice('TSLA');
    expect(price).toBe(247.5);
  });

  it('returns undefined for unknown symbol', async () => {
    mockFetch(new Map());
    const provider = await importProvider();
    const price = await provider.getSpotPrice('FAKESYM');
    expect(price).toBeUndefined();
  });

  it('maps option chain snapshot with exchange greeks', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/TSLA/prev',
        { status: 'OK', results: [{ c: 250 }] },
      ],
      [
        '/v3/snapshot/options/TSLA',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 280,
              },
              greeks: { delta: 0.25 },
              implied_volatility: 0.55,
              open_interest: 1200,
              last_quote: { bid: 5.2, ask: 5.8 },
            },
            {
              details: {
                contract_type: 'put',
                expiration_date: '2026-05-15',
                strike_price: 220,
              },
              greeks: { delta: -0.2 },
              implied_volatility: 0.6,
              open_interest: 800,
              last_quote: { bid: 3.1, ask: 3.5 },
            },
          ],
        },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const chain = await provider.getOptionChain('TSLA', 0.045);

    expect(chain).toBeDefined();
    expect(chain!.symbol).toBe('TSLA');
    expect(chain!.underlyingPrice).toBe(250);
    expect(chain!.expirations).toHaveLength(1);

    const slice = chain!.expirations[0]!;
    expect(slice.date).toBe('2026-05-15');
    expect(slice.calls).toHaveLength(1);
    expect(slice.puts).toHaveLength(1);

    // Exchange delta should be used directly.
    expect(slice.calls[0]!.delta).toBe(0.25);
    expect(slice.calls[0]!.strike).toBe(280);
    expect(slice.calls[0]!.iv).toBe(0.55);

    expect(slice.puts[0]!.delta).toBe(-0.2);
    expect(slice.puts[0]!.strike).toBe(220);
  });

  it('falls back to BS delta when greeks are missing', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/AAPL/prev',
        { status: 'OK', results: [{ c: 200 }] },
      ],
      [
        '/v3/snapshot/options/AAPL',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 210,
              },
              // No greeks field at all.
              implied_volatility: 0.3,
              open_interest: 500,
              last_quote: { bid: 2.0, ask: 2.5 },
            },
          ],
        },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const chain = await provider.getOptionChain('AAPL', 0.045);

    expect(chain).toBeDefined();
    const call = chain!.expirations[0]!.calls[0]!;
    // Delta should be computed via BS, should be positive and < 1 for OTM call.
    expect(call.delta).toBeGreaterThan(0);
    expect(call.delta).toBeLessThan(1);
  });

  it('handles pagination via next_url', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/SPY/prev',
        { status: 'OK', results: [{ c: 500 }] },
      ],
      [
        '/v3/snapshot/options/SPY?limit=250',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 510,
              },
              greeks: { delta: 0.3 },
              implied_volatility: 0.18,
              open_interest: 5000,
              last_quote: { bid: 4.0, ask: 4.5 },
            },
          ],
          next_url:
            'https://api.polygon.io/v3/snapshot/options/SPY?cursor=page2',
        },
      ],
      [
        'cursor=page2',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'put',
                expiration_date: '2026-05-15',
                strike_price: 490,
              },
              greeks: { delta: -0.25 },
              implied_volatility: 0.2,
              open_interest: 3000,
              last_quote: { bid: 3.0, ask: 3.4 },
            },
          ],
        },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const chain = await provider.getOptionChain('SPY', 0.045);

    expect(chain).toBeDefined();
    const slice = chain!.expirations[0]!;
    expect(slice.calls).toHaveLength(1);
    expect(slice.puts).toHaveLength(1);
  });

  it('getMarketData returns full snapshot', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/MSFT/prev',
        { status: 'OK', results: [{ c: 420 }] },
      ],
      [
        '/v3/snapshot/options/MSFT',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 440,
              },
              greeks: { delta: 0.22 },
              implied_volatility: 0.25,
              open_interest: 2000,
              last_quote: { bid: 6.0, ask: 6.5 },
            },
          ],
        },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const snap: MarketSnapshot = await provider.getMarketData(
      ['MSFT'],
      0.045,
    );

    expect(snap.mode).toBe('real');
    expect(snap.source).toBe('Polygon.io');
    expect(snap.prices.get('MSFT')).toBe(420);
    expect(snap.chains.has('MSFT')).toBe(true);
  });

  it('filters contracts with zero bid and ask', async () => {
    const responses = new Map<string, unknown>([
      [
        '/v2/aggs/ticker/T/prev',
        { status: 'OK', results: [{ c: 20 }] },
      ],
      [
        '/v3/snapshot/options/T',
        {
          status: 'OK',
          results: [
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 25,
              },
              greeks: { delta: 0.15 },
              implied_volatility: 0.3,
              open_interest: 100,
              last_quote: { bid: 0, ask: 0 },
            },
            {
              details: {
                contract_type: 'call',
                expiration_date: '2026-05-15',
                strike_price: 22,
              },
              greeks: { delta: 0.45 },
              implied_volatility: 0.3,
              open_interest: 500,
              last_quote: { bid: 1.5, ask: 1.8 },
            },
          ],
        },
      ],
    ]);
    mockFetch(responses);
    const provider = await importProvider();
    const chain = await provider.getOptionChain('T', 0.045);

    // Only the contract with valid bid/ask should survive.
    expect(chain!.expirations[0]!.calls).toHaveLength(1);
    expect(chain!.expirations[0]!.calls[0]!.strike).toBe(22);
  });
});

describe('PolygonProvider fallback', () => {
  it('createProvider does not throw when no env API key', async () => {
    delete process.env['POLYGON_API_KEY'];
    const { createProvider } = await import('../src/data/index.js');
    // If config/polygon.json exists on disk, PolygonProvider is returned;
    // otherwise MockProvider. Either is fine — no crash is the assertion.
    const p = createProvider('real');
    expect(p).toBeDefined();
  });
});
