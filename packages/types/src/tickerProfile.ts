/** Closed hourly candles, trailing 30 calendar days, monthly UTC assignments. */
export interface TickerProfile {
  symbol: string;
  asOf: number;
  validUntil: number;
  windowStart: number;
  hours: number;
  returnHours: number;
  btcAlignedHours: number;
  ethAlignedHours: number;
  turnoverSource: 'quote' | 'estimated' | 'mixed' | 'unknown';
  dailyTurnoverUSDT: number | null;
  dailyVolatilityPct: number | null;
  correlationBTC: number | null;
  correlationETH: number | null;
  moneyGroup: 'low' | 'middle' | 'high' | 'unknown';
  volatilityGroup: 'low' | 'middle' | 'high' | 'unknown';
  btcCorrelationGroup: 'weak' | 'medium' | 'strong' | 'unknown';
  ethCorrelationGroup: 'weak' | 'medium' | 'strong' | 'unknown';
}

export interface TickerProfileSnapshot {
  schema: 'tradejs-ticker-profiles/v1';
  definition: 'hourly-30d-monthly-terciles/v1';
  provider: string;
  universeId: string;
  /** Describes the known membership; never infer historical listings from candles. */
  membership: 'frozen-list' | 'point-in-time';
  asOf: number;
  validUntil: number;
  thresholds: {
    money: [number | null, number | null];
    volatility: [number | null, number | null];
  };
  profiles: TickerProfile[];
}

export interface TickerProfileContext extends TickerProfile {
  definition: TickerProfileSnapshot['definition'];
  provider: string;
  universeId: string;
  snapshotId: string;
}
