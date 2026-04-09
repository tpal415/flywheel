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
  it('fires on a threatened ITM short call', () => {
    const chains = buildDemoChains();
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options, chains, DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    expect(tsla!.contract.strike).toBeGreaterThanOrEqual(225);
    expect(tsla!.netCredit).toBeGreaterThan(0);
  });

  it('reports named trigger labels', () => {
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    expect(tsla).toBeDefined();
    const labels = tsla!.triggers.map((t) => t.label);
    expect(labels).toContain('DELTA');
    expect(labels).toContain('DTE_RATIO');
  });

  it('does not fire on safe far-OTM fresh position', () => {
    const safe: OptionPosition = {
      id: 'safe-1', symbol: 'MSFT', type: 'CALL', strike: 460,
      expiration: '2026-05-23', contracts: 1, openPrice: 3,
      side: 'SHORT', originalDte: 45, openedOn: '2026-04-08',
    };
    const rolls = generateRollRecommendations(
      [safe], buildDemoChains(), DEMO_SETTINGS,
    );
    expect(rolls.length).toBe(0);
  });

  it('skips LONG positions', () => {
    const long: OptionPosition = {
      id: 'long-1', symbol: 'TSLA', type: 'CALL', strike: 225,
      expiration: '2026-04-15', contracts: 1, openPrice: 4,
      side: 'LONG', originalDte: 30, openedOn: '2026-03-09',
    };
    expect(
      generateRollRecommendations([long], buildDemoChains(), DEMO_SETTINGS).length,
    ).toBe(0);
  });

  it('respects per-ticker roll overrides', () => {
    const override: TickerOverride = {
      symbol: 'TSLA',
      roll: { deltaThreshold: 0.99 },
    };
    const rolls = generateRollRecommendations(
      DEMO_PORTFOLIO.options, buildDemoChains(), DEMO_SETTINGS, [override],
    );
    const tsla = rolls.find((r) => r.symbol === 'TSLA');
    if (tsla) {
      expect(tsla.triggers.map((t) => t.label)).not.toContain('DELTA');
    }
  });

  it('is deterministic', () => {
    const a = generateRollRecommendations(
      DEMO_PORTFOLIO.options, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    const b = generateRollRecommendations(
      DEMO_PORTFOLIO.options, buildDemoChains(), DEMO_SETTINGS, DEMO_OVERRIDES,
    );
    expect(b).toEqual(a);
  });
});
