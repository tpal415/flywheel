/**
 * Stock and option position types held in the user's portfolio.
 */

export interface StockPosition {
  readonly id: string;
  readonly symbol: string;
  readonly shares: number;
  readonly avgCostBasis: number;
  readonly currentPrice: number;
}

export type OptionType = 'CALL' | 'PUT';
export type OptionSide = 'SHORT' | 'LONG';

export interface OptionPosition {
  readonly id: string;
  readonly symbol: string;
  readonly type: OptionType;
  readonly strike: number;
  /** ISO date string YYYY-MM-DD */
  readonly expiration: string;
  readonly contracts: number;
  readonly openPrice: number;
  readonly side: OptionSide;
  /** Original DTE when the position was opened (used for roll trigger math). */
  readonly originalDte: number;
  /** ISO date string YYYY-MM-DD of when the position was opened. */
  readonly openedOn: string;
}

export interface ClosedTrade {
  readonly id: string;
  readonly symbol: string;
  readonly type: OptionType;
  readonly contracts: number;
  /** Net premium captured in dollars (positive = credit to the user). */
  readonly netPremium: number;
  /** ISO date string YYYY-MM-DD of close. */
  readonly closedOn: string;
}

export interface Portfolio {
  readonly cash: number;
  readonly stocks: readonly StockPosition[];
  readonly options: readonly OptionPosition[];
  readonly closedTrades: readonly ClosedTrade[];
  /** Symbols the user is willing to own via CSP assignment. */
  readonly watchlist: readonly string[];
}
