/**
 * Minimal Black-Scholes implementation used by the fixture chain generator
 * and any engine code that needs to sanity-check option values.
 *
 * All functions are pure. Risk-free rate and dividend yield are accepted as
 * decimal rates (e.g. 0.045 == 4.5%). Time is in years.
 *
 * This is intentionally a small, dependency-free module — good enough for
 * offline fixtures and deterministic tests, not a production pricing library.
 */

/**
 * Abramowitz & Stegun approximation of the standard normal CDF.
 * Error < 7.5e-8. Deterministic, branch-stable.
 */
export function normCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export interface BsInputs {
  /** Spot price. */
  readonly s: number;
  /** Strike price. */
  readonly k: number;
  /** Time to expiration, in years. */
  readonly t: number;
  /** Risk-free rate (annualized decimal). */
  readonly r: number;
  /** Annualized volatility (decimal). */
  readonly sigma: number;
  /** Continuous dividend yield (annualized decimal). Default 0. */
  readonly q?: number;
}

interface D1D2 {
  readonly d1: number;
  readonly d2: number;
}

function d1d2(inputs: BsInputs): D1D2 {
  const { s, k, t, r, sigma } = inputs;
  const q = inputs.q ?? 0;
  const vt = sigma * Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * sigma * sigma) * t) / vt;
  const d2 = d1 - vt;
  return { d1, d2 };
}

/** European call price. */
export function bsCall(inputs: BsInputs): number {
  const { s, k, t, r } = inputs;
  const q = inputs.q ?? 0;
  if (t <= 0) return Math.max(0, s - k);
  const { d1, d2 } = d1d2(inputs);
  return s * Math.exp(-q * t) * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
}

/** European put price. */
export function bsPut(inputs: BsInputs): number {
  const { s, k, t, r } = inputs;
  const q = inputs.q ?? 0;
  if (t <= 0) return Math.max(0, k - s);
  const { d1, d2 } = d1d2(inputs);
  return (
    k * Math.exp(-r * t) * normCdf(-d2) - s * Math.exp(-q * t) * normCdf(-d1)
  );
}

/** Call delta: in (0, 1). */
export function callDelta(inputs: BsInputs): number {
  const q = inputs.q ?? 0;
  if (inputs.t <= 0) return inputs.s > inputs.k ? 1 : 0;
  const { d1 } = d1d2(inputs);
  return Math.exp(-q * inputs.t) * normCdf(d1);
}

/** Put delta: in (-1, 0). */
export function putDelta(inputs: BsInputs): number {
  const q = inputs.q ?? 0;
  if (inputs.t <= 0) return inputs.s < inputs.k ? -1 : 0;
  const { d1 } = d1d2(inputs);
  return Math.exp(-q * inputs.t) * (normCdf(d1) - 1);
}
