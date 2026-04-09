export type { MarketDataProvider, MarketSnapshot, DataMode } from './types.js';
export { MockProvider } from './mock.js';
export { YahooProvider } from './yahoo.js';

import type { DataMode, MarketDataProvider } from './types.js';
import { MockProvider } from './mock.js';
import { YahooProvider } from './yahoo.js';

/**
 * Create a market data provider for the given mode.
 */
export function createProvider(mode: DataMode): MarketDataProvider {
  switch (mode) {
    case 'mock':
      return new MockProvider();
    case 'real':
      return new YahooProvider();
  }
}
