/**
 * Demo fixtures — thin wrappers around the config loader.
 *
 * In Phase 1 these were hard-coded. Now they read from config/ JSON files,
 * but this module re-exports the same constants the tests expect.
 */

import { loadConfig } from '../config/loader.js';

const _demo = loadConfig();

export const EVAL_DATE = _demo.evaluationDate;
export const DEMO_PORTFOLIO = _demo.portfolio;
export const DEMO_SETTINGS = _demo.settings;
export const DEMO_OVERRIDES = _demo.overrides;
export const DEMO_CHAINS = _demo.chains;

/** Convenience: build chains via the config loader. */
export function buildDemoChains(): ReadonlyMap<
  string,
  import('../types/chains.js').OptionChain
> {
  return _demo.chains;
}
