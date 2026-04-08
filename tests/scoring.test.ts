import { describe, it, expect } from 'vitest';
import { annualizedYield, computeScore } from '../src/engine/scoring.js';

describe('annualizedYield', () => {
  it('computes (premium / notional) * (365 / dte) for known inputs', () => {
    // $200 premium on $20,000 notional for 20 DTE → 0.01 * 18.25 = 0.1825
    const ay = annualizedYield(200, 20_000, 20);
    expect(ay).toBeCloseTo(0.1825, 6);
  });

  it('returns 0 when inputs are degenerate', () => {
    expect(annualizedYield(100, 0, 20)).toBe(0);
    expect(annualizedYield(100, 10_000, 0)).toBe(0);
    expect(annualizedYield(100, -1, 20)).toBe(0);
  });

  it('scales linearly with premium', () => {
    const a = annualizedYield(100, 10_000, 30);
    const b = annualizedYield(200, 10_000, 30);
    expect(b).toBeCloseTo(a * 2, 9);
  });
});

describe('computeScore', () => {
  it('is monotonic in yield component', () => {
    const lo = computeScore(0.1, 0.05, 0.2);
    const hi = computeScore(0.5, 0.05, 0.2);
    expect(hi).toBeGreaterThan(lo);
  });

  it('is monotonic in safety (lower assignment is better)', () => {
    const risky = computeScore(0.3, 0.05, 0.9);
    const safe = computeScore(0.3, 0.05, 0.1);
    expect(safe).toBeGreaterThan(risky);
  });

  it('stays in [0, 1]', () => {
    const s1 = computeScore(10, 1, 0);
    const s2 = computeScore(-1, -1, 1);
    expect(s1).toBeLessThanOrEqual(1 + 1e-9);
    expect(s2).toBeGreaterThanOrEqual(-1e-9);
  });
});
