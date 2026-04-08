import { describe, it, expect } from 'vitest';
import { generateRollRecommendations } from '../src/engine/rolls.js';
import {
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  buildDemoChains,
} from '../src/fixtures/index.js';
import type { OptionPosition } from '../src/types/positions.js';

describe('generateRollRecommendations', () => {
  it('fires on a threatened ITM short call within the trigger band', () => {
    const chains = buildDemoChains();
    // The demo TSLA 225 short call is ITM at spot 240 and at 7/30 DTE.
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      chains,
      DEMO_SETTINGS,
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    // New strike must be same-or-better (further OTM, i.e. > 225 for a call)
    // and expiration must be equal or further out.
    expect(tsla!.contract.strike).toBeGreaterThanOrEqual(225);
    expect(tsla!.expiration >= '2026-04-15').toBe(true);
    expect(tsla!.netCredit).toBeGreaterThan(0);
  });

  it('does not fire on a safe, far-OTM, fresh position', () => {
    const chains = buildDemoChains();
    const safe: OptionPosition = {
      id: 'safe-1',
      symbol: 'MSFT',
      type: 'CALL',
      strike: 460, // well OTM
      expiration: '2026-05-23',
      contracts: 1,
      openPrice: 3,
      side: 'SHORT',
      originalDte: 45,
      openedOn: '2026-04-08',
    };
    const rolls = generateRollRecommendations(
      [safe],
      chains,
      DEMO_SETTINGS,
    );
    expect(rolls.length).toBe(0);
  });

  it('skips LONG positions entirely', () => {
    const chains = buildDemoChains();
    const long: OptionPosition = {
      id: 'long-1',
      symbol: 'TSLA',
      type: 'CALL',
      strike: 225,
      expiration: '2026-04-15',
      contracts: 1,
      openPrice: 4,
      side: 'LONG',
      originalDte: 30,
      openedOn: '2026-03-09',
    };
    const rolls = generateRollRecommendations(
      [long],
      chains,
      DEMO_SETTINGS,
    );
    expect(rolls.length).toBe(0);
  });
});
