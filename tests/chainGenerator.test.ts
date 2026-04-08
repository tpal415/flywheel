import { describe, it, expect } from 'vitest';
import { generateChain } from '../src/fixtures/generateChain.js';

describe('generateChain', () => {
  it('is deterministic', () => {
    const a = generateChain({
      symbol: 'TEST',
      spot: 100,
      ivAnnual: 0.3,
      expirations: [
        { date: '2026-04-15', dte: 7 },
        { date: '2026-04-29', dte: 21 },
      ],
    });
    const b = generateChain({
      symbol: 'TEST',
      spot: 100,
      ivAnnual: 0.3,
      expirations: [
        { date: '2026-04-15', dte: 7 },
        { date: '2026-04-29', dte: 21 },
      ],
    });
    expect(b).toEqual(a);
  });

  it('produces strikes spanning ~±25% of spot', () => {
    const chain = generateChain({
      symbol: 'TEST',
      spot: 100,
      ivAnnual: 0.3,
      expirations: [{ date: '2026-04-29', dte: 21 }],
    });
    const slice = chain.expirations[0]!;
    const strikes = slice.calls.map((c) => c.strike);
    expect(Math.min(...strikes)).toBeGreaterThanOrEqual(75);
    expect(Math.max(...strikes)).toBeLessThanOrEqual(125);
    expect(strikes.length).toBeGreaterThan(10);
  });

  it('call delta is positive and put delta is negative', () => {
    const chain = generateChain({
      symbol: 'TEST',
      spot: 100,
      ivAnnual: 0.3,
      expirations: [{ date: '2026-04-29', dte: 21 }],
    });
    const slice = chain.expirations[0]!;
    for (const c of slice.calls) expect(c.delta).toBeGreaterThanOrEqual(0);
    for (const p of slice.puts) expect(p.delta).toBeLessThanOrEqual(0);
  });

  it('bid is always ≤ ask and both are positive', () => {
    const chain = generateChain({
      symbol: 'TEST',
      spot: 100,
      ivAnnual: 0.3,
      expirations: [{ date: '2026-04-29', dte: 21 }],
    });
    const slice = chain.expirations[0]!;
    for (const c of [...slice.calls, ...slice.puts]) {
      expect(c.bid).toBeGreaterThan(0);
      expect(c.ask).toBeGreaterThanOrEqual(c.bid);
    }
  });
});
