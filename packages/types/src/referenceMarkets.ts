/** Bybit USDT reference market measurements available at a signal timestamp. */
export interface ReferenceMarketFrame {
  /** UTC close of the expected candle, even when some instruments are absent. */
  closedAt: number;
  /** Log returns in percent. Missing exact adjacent closes are omitted. */
  returnsPct: Partial<Record<string, number>>;
  growthPct: number | null;
  defensivePct: number | null;
  cyclicalPct: number | null;
  growthMinusDefensivePct: number | null;
  goldMinusGrowthPct: number | null;
  /** Full NY weekday cash-hours candle, with nonzero volume in both closes. */
  nyCashHoursGrowthPct: number | null;
}

export interface ReferenceMarketsContext {
  schema: 'tradejs-reference-markets/v1';
  provider: 'bybit';
  frames: Partial<Record<'m15' | 'h1' | 'h4', ReferenceMarketFrame>>;
}
