/**
 * Option chain types - the market data the engine reasons over.
 */

export interface OptionContract {
  readonly strike: number;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  /**
   * Black-Scholes delta. For calls this is in [0, 1]; for puts this is in
   * [-1, 0]. The engine treats `|delta|` as an approximation of assignment
   * probability (see `assignmentProb` in the recommendation types).
   */
  readonly delta: number;
  /** Annualized implied volatility as a decimal (0.45 == 45%). */
  readonly iv: number;
  readonly openInterest: number;
  /** Days to expiration from the evaluation date. */
  readonly dte: number;
}

export interface ExpirationSlice {
  /** ISO date string YYYY-MM-DD */
  readonly date: string;
  readonly calls: readonly OptionContract[];
  readonly puts: readonly OptionContract[];
}

export interface OptionChain {
  readonly symbol: string;
  readonly underlyingPrice: number;
  readonly expirations: readonly ExpirationSlice[];
}
