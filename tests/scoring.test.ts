import { describe, it, expect } from 'vitest';
import { annualizedYield, computeScore, type ScoreInputs } from '../src/engine/scoring.js';

const BASE: ScoreInputs = {
  annualizedYield: 0.3,
  distancePct: 0.10,
  assignmentProb: 0.25,
  costBasisMarginPct: 0.3,
  assignmentPreference: 'neutral',
  strategyMode: 'balanced',
  compounder: false,
};

describe('annualizedYield', () => {
  it('computes (premium / notional) * (365 / dte)', () => {
    expect(annualizedYield(200, 20_000, 20)).toBeCloseTo(0.1825, 6);
  });

  it('returns 0 for degenerate inputs', () => {
    expect(annualizedYield(100, 0, 20)).toBe(0);
    expect(annualizedYield(100, 10_000, 0)).toBe(0);
  });
});

describe('computeScore', () => {
  it('is monotonic in yield', () => {
    const lo = computeScore({ ...BASE, annualizedYield: 0.1 });
    const hi = computeScore({ ...BASE, annualizedYield: 0.5 });
    expect(hi).toBeGreaterThan(lo);
  });

  it('is monotonic in safety (lower assignment better)', () => {
    const risky = computeScore({ ...BASE, assignmentProb: 0.9 });
    const safe = computeScore({ ...BASE, assignmentProb: 0.1 });
    expect(safe).toBeGreaterThan(risky);
  });

  it('stays in [0, 1]', () => {
    const s1 = computeScore({ ...BASE, annualizedYield: 10, distancePct: 1 });
    const s2 = computeScore({
      ...BASE,
      annualizedYield: -1,
      distancePct: -1,
      assignmentProb: 1,
    });
    expect(s1).toBeLessThanOrEqual(1 + 1e-9);
    expect(s2).toBeGreaterThanOrEqual(-1e-9);
  });

  it('"prefer" scores higher than "avoid" on a high-yield high-delta candidate', () => {
    // High yield + high delta: "prefer" is happy to collect premium and
    // accept assignment; "avoid" is penalized by the high delta.
    const avoidHigh = computeScore({
      ...BASE,
      annualizedYield: 1.0,
      assignmentPreference: 'avoid',
      assignmentProb: 0.8,
    });
    const preferHigh = computeScore({
      ...BASE,
      annualizedYield: 1.0,
      assignmentPreference: 'prefer',
      assignmentProb: 0.8,
    });
    expect(preferHigh).toBeGreaterThan(avoidHigh);
  });

  it('compounder penalty reduces score for close-to-spot strikes', () => {
    const normal = computeScore({ ...BASE, distancePct: 0.03 });
    const compounder = computeScore({
      ...BASE,
      distancePct: 0.03,
      compounder: true,
    });
    expect(compounder).toBeLessThan(normal);
  });

  it('compounder penalty does NOT fire for far-OTM strikes', () => {
    const normal = computeScore({ ...BASE, distancePct: 0.15 });
    const compounder = computeScore({
      ...BASE,
      distancePct: 0.15,
      compounder: true,
    });
    expect(compounder).toBe(normal);
  });

  it('strategy mode shifts scoring', () => {
    const income = computeScore({ ...BASE, strategyMode: 'incomeFocused' });
    const upside = computeScore({ ...BASE, strategyMode: 'upsideFocused' });
    // incomeFocused should weight yield more — with moderate yield, income mode
    // should score higher on the yield component.
    // This is a directional test, not exact values.
    expect(income).not.toBe(upside);
  });
});
