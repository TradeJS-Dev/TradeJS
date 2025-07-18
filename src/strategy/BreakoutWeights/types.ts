export type IndicatorsContext = {
  smaFast: number;
  smaSlow: number;
  obv: number;
  smaObv: number | undefined;
  price: number;
  bb: { upper: number; lower: number };
  mom: number;
  hadSqueeze: boolean;
  highLevel: number;
  lowLevel: number;
};

export type WeightKey =
  | 'smaTrend'
  | 'obvTrend'
  | 'bbBreakout'
  | 'momDirection'
  | 'hadSqueeze'
  | 'priceBreakout';

export type ConditionResult = {
  score: number;
  conditions: Record<string, boolean>;
};
