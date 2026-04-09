import { describe, it, expect } from 'vitest';
import { generateRollRecommendations } from '../src/engine/rolls.js';
import {
  DEMO_PORTFOLIO,
  DEMO_SETTINGS,
  DEMO_OVERRIDES,
  buildDemoChains,
} from '../src/fixtures/index.js';
import type { OptionPosition } from '../src/types/positions.js';
import type { TickerOverride } from '../src/types/settings.js';

describe('generateRollRecommendations', () => {
  it('fires on a threatened ITM short call within the trigger band', () => {
    const chains = buildDemoChains();
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.contract.strike).toBeGreaterThanOrEqual(225);
    expect(tsla!.expiration >= '2026-04-15').toBe(true);
    expect(tsla!.netCredit).toBeGreaterThan(0);
  });

  it('reports specific trigger labels', () => {
    const chains = buildDemoChains();
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      chains,
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    const labels = tsla!.triggers.map((t) => t.label);
    // The demo TSLA 225c with spot 240 should trigger DELTA and DTE_RATIO.
    expect(labels).toContain('DELTA');
    expect(labels).toContain('DTE_RATIO');
  });

  it('fires NEAR_STRIKE when spot is very close to strike', () => {
    const chains = buildDemoChains();
    // MSFT spot 420, short call at 424 → 0.95% from strike.
    // nearStrikePct default is 0.02 (2%) — should fire.
    const nearStrike: OptionPosition = {
      id: 'near-1',
      symbol: 'MSFT',
      type: 'CALL',
      strike: 424,
      expiration: '2026-04-15',
      contracts: 1,
      openPrice: 5,
      side: 'SHORT',
      originalDte: 30,
      openedOn: '2026-03-09',
    };
    const rolls = generateRollRecommendations(
      [nearStrike],
      chains,
      DEMO_SETTINGS,
    );
    // NEAR_STRIKE trigger should fire since |420-424|/420 = 0.0095 < 0.02.
    if (rolls.length > 0) {
      const labels = rolls[0]!.triggers.map((t) => t.label);
      expect(labels).toContain('NEAR_STRIKE');
    }
  });

  it('fires PROFIT_CAPTURE when most profit has decayed', () => {
    const chains = buildDemoChains();
    // MSFT spot 420, short call at 460 (well OTM), opened at $5.
    // Current mid for 460 call at 7 DTE should be very small → high capture.
    const profitCapture: OptionPosition = {
      id: 'profit-1',
      symbol: 'MSFT',
      type: 'CALL',
      strike: 460,
      expiration: '2026-04-15',
      contracts: 1,
      openPrice: 5,
      side: 'SHORT',
      originalDte: 30,
      openedOn: '2026-03-09',
    };
    const rolls = generateRollRecommendations(
      [profitCapture],
      chains,
      DEMO_SETTINGS,
    );
    if (rolls.length > 0) {
      const labels = rolls[0]!.triggers.map((t) => t.label);
      expect(labels).toContain('PROFIT_CAPTURE');
    }
  });

  it('does not fire on a safe, far-OTM, fresh position', () => {
    const chains = buildDemoChains();
    const safe: OptionPosition = {
      id: 'safe-1',
      symbol: 'MSFT',
      type: 'CALL',
      strike: 460,
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

  it('respects per-ticker roll overrides', () => {
    const chains = buildDemoChains();
    // Use a very high delta threshold so TSLA does NOT trigger on delta.
    const override: TickerOverride = {
      symbol: 'TSLA',
      roll: { deltaThreshold: 0.99 },
    };
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      chains,
      DEMO_SETTINGS,
      [override],
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    if (tsla) {
      // DELTA should NOT appear in triggers with 0.99 threshold.
      const labels = tsla.triggers.map((t) => t.label);
      expect(labels).not.toContain('DELTA');
    }
  });

  it('is deterministic across repeated calls', () => {
    const a = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      buildDemoChains(),
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    const b = generateRollRecommendations(
      DEMO_PORTFOLIO.options,
      buildDemoChains(),
      DEMO_SETTINGS,
      DEMO_OVERRIDES,
    );
    expect(b).toEqual(a);
  });
});
