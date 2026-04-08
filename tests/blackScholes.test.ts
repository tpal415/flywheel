import { describe, it, expect } from 'vitest';
import {
  bsCall,
  bsPut,
  callDelta,
  normCdf,
  putDelta,
} from '../src/engine/blackScholes.js';

describe('blackScholes', () => {
  it('normCdf boundary values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(-5)).toBeLessThan(1e-5);
    expect(normCdf(5)).toBeGreaterThan(1 - 1e-5);
  });

  it('put-call parity holds (within tolerance)', () => {
    const s = 100;
    const k = 100;
    const t = 0.5;
    const r = 0.05;
    const sigma = 0.2;
    const c = bsCall({ s, k, t, r, sigma });
    const p = bsPut({ s, k, t, r, sigma });
    // C - P = S - K * exp(-r*t)
    const lhs = c - p;
    const rhs = s - k * Math.exp(-r * t);
    expect(lhs).toBeCloseTo(rhs, 6);
  });

  it('call delta approaches 1 deep ITM and 0 deep OTM', () => {
    const base = { t: 0.25, r: 0.04, sigma: 0.3 };
    expect(callDelta({ s: 200, k: 50, ...base })).toBeGreaterThan(0.99);
    expect(callDelta({ s: 50, k: 200, ...base })).toBeLessThan(0.01);
  });

  it('put delta approaches -1 deep ITM and 0 deep OTM', () => {
    const base = { t: 0.25, r: 0.04, sigma: 0.3 };
    expect(putDelta({ s: 50, k: 200, ...base })).toBeLessThan(-0.99);
    expect(putDelta({ s: 200, k: 50, ...base })).toBeGreaterThan(-0.01);
  });
});
