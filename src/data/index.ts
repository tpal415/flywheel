export type { MarketDataProvider, MarketSnapshot, DataMode } from './types.js';
export { MockProvider } from './mock.js';
export { YahooProvider } from './yahoo.js';
export { PolygonProvider } from './polygon.js';
export { buildComparison, printComparison } from './compare.js';
export type { ComparisonResult } from './compare.js';

import type { DataMode, MarketDataProvider } from './types.js';
import { MockProvider } from './mock.js';
import { PolygonProvider } from './polygon.js';

/**
 * Create a market data provider for the given mode.
 *
 * "real" uses Polygon.io (requires POLYGON_API_KEY env var or
 * config/polygon.json). Falls back to mock if the key is missing.
 */
export function createProvider(mode: DataMode): MarketDataProvider {
  if (mode === 'real') {
    try {
      return new PolygonProvider();
    } catch (e: unknown) {
      console.error(
        `[data] ${e instanceof Error ? e.message : String(e)}`,
      );
      console.error('[data] Falling back to mock provider.\n');
      return new MockProvider();
    }
  }
  return new MockProvider();
}
