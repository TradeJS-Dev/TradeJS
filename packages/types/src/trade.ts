import { KlineIntervalV3 } from 'bybit-api';

export type Interval = KlineIntervalV3;
export type Provider = 'bybit' | 'binance' | 'coinbase';

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  turnover: number;
}

export interface KlineChartItem extends Candle {
  dt: string;
  [key: string]: unknown;
}

export type KlineChartData = Array<KlineChartItem>;

export interface KlineRequest {
  symbol: string;
  interval: Interval;
  start?: number;
  end: number;
  silent?: boolean;
  cacheOnly?: boolean;
  warmOnly?: boolean;
}

export type DerivativesInterval = '15m' | '1h';

export type DerivativesRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  openInterest?: number | null;
  fundingRate?: number | null;
  liqLong?: number | null;
  liqShort?: number | null;
  liqTotal?: number | null;
  source?: string | null;
};

export type DerivativesPressure =
  | 'neutral'
  | 'crowded_long'
  | 'crowded_short'
  | 'long_flush'
  | 'short_flush';

export type DerivativesContextRiskFlag =
  | 'missing_derivatives'
  | 'stale_derivatives'
  | 'crowded_long'
  | 'crowded_short'
  | 'oi_falling'
  | 'oi_not_confirming'
  | 'long_liquidation_spike'
  | 'short_liquidation_spike';

export interface DerivativesIntervalContext {
  interval: DerivativesInterval;
  asOfTs: number | null;
  stale: boolean;
  points: number;
  openInterest: number | null;
  oiChangePct1h: number | null;
  oiChangePct4h: number | null;
  oiChangePct24h: number | null;
  fundingRate: number | null;
  fundingZScore: number | null;
  liqLong: number | null;
  liqShort: number | null;
  liqTotal: number | null;
  liqImbalance: number | null;
  liqSpikeRatio: number | null;
}

export interface DerivativesContext {
  source: 'coinalyze';
  symbol: string;
  timestamp: number;
  intervals: Partial<Record<DerivativesInterval, DerivativesIntervalContext>>;
  summary: {
    pressure: DerivativesPressure;
    directionAligned: boolean | null;
    riskFlags: DerivativesContextRiskFlag[];
  };
}

export type SpreadRow = {
  symbol: string;
  interval: DerivativesInterval;
  ts: Date;
  binancePrice?: number | null;
  coinbasePrice?: number | null;
  spread?: number | null;
  source?: string | null;
};

export interface Tp {
  price: number;
  rate: number;
  done?: boolean;
}

export type Sl = number | null;

export type Direction = 'LONG' | 'SHORT';
export type Trend = 'BULL' | 'BEAR';

export type Order = {
  symbol: string;
  isLimit?: boolean;
  qty: number;
  price: number;
  timestamp: number;
  direction: Direction;
  orderId?: string;
  signal?: Signal;
};

export type Position = {
  symbol: string;
  qty: number;
  price: number;
  direction: Direction;
};

export interface PositionPnlSnapshot extends Position {
  currentPrice: number;
  unrealizedPnl: number;
}

export type OrderType =
  | 'OPEN_LONG'
  | 'OPEN_SHORT'
  | 'CLOSE_LONG'
  | 'CLOSE_SHORT'
  | 'TAKE_PROFIT_LONG'
  | 'TAKE_PROFIT_SHORT'
  | 'STOP_LOSS_LONG'
  | 'STOP_LOSS_SHORT';

export type ConnectorCreator = (config: ConnectorConfig) => Promise<Connector>;

export interface ConnectorConfig {
  userName: string;
}

export interface ConnectorRegistryEntry {
  name: string;
  creator: ConnectorCreator;
  providers?: string[];
}

export interface ConnectorPluginDefinition {
  connectorEntries: ConnectorRegistryEntry[];
}

type GetPosition = (symbol: string) => Promise<Position | null>;
type GetPositions = () => Promise<Position[]>;
type GetOpenPositionPnl = () => Promise<PositionPnlSnapshot[]>;
export interface ClosedPnlRecord {
  symbol: string;
  qty: number;
  entryPrice: number | null;
  exitPrice: number | null;
  closedPnl: number;
  closedAt: number;
  orderId?: string;
}

export interface GetClosedPnlParams {
  startTime: number;
  endTime: number;
  symbol?: string;
  limit?: number;
}

type GetClosedPnl = (params: GetClosedPnlParams) => Promise<ClosedPnlRecord[]>;
type PlaceOrder = (order: Order) => Promise<boolean>;
type ClosePosition = (order: Omit<Order, 'qty'>) => Promise<boolean>;
type SetTakeProfits = (params: {
  symbol: string;
  direction: Direction;
  qty?: number;
  takeProfits: Tp[];
}) => Promise<boolean>;
type SetStopLoss = (params: {
  symbol: string;
  direction: Direction;
  stopLossPrice: Sl;
}) => Promise<boolean>;
export type Kline = (options: KlineRequest) => Promise<KlineChartData>;
export type GetTickers = () => Promise<Ticker[]>;

export interface Connector {
  kline: Kline;
  getState: () => Promise<object>;
  setState: (state: object) => Promise<void>;
  getPosition: GetPosition;
  getPositions: GetPositions;
  getOpenPositionPnl?: GetOpenPositionPnl;
  getClosedPnl?: GetClosedPnl;
  placeOrder: PlaceOrder;
  setTakeProfits: SetTakeProfits;
  setStopLoss: SetStopLoss;
  closePosition: ClosePosition;
  getTickers: GetTickers;
}

export interface Indicator {
  id: string;
  label: string;
  enabled: boolean;
  periods?: Array<number>;
}

export type Indicators = Indicator[];

export interface Filters {
  provider?: Provider;
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
}

export interface Ticker {
  symbol: string;
  lastPrice: number;
  indexPrice: number;
  markPrice: number;
  prevPrice24h: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  prevPrice1h: number;
  openInterest: number;
  openInterestValue: number;
  turnover24h: number;
  volume24h: number;
  fundingRate: number;
  nextFundingTime: number;
  predictedDeliveryPrice: string;
  basisRate: string;
  deliveryFeeRate: string;
  deliveryTime: number;
  ask1Size: number;
  bid1Price: number;
  ask1Price: number;
  bid1Size: number;
  basis: string;
  preOpenPrice: string;
  preQty: string;
}

export type TrendLineMode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  mode: TrendLineMode;
  distance: number;
  touches: { timestamp: number; value: number }[];
  points: { timestamp: number; value: number }[];
  alpha?: number[];
};

export interface StrategyFigurePoint {
  timestamp: number;
  value: number;
}

export interface StrategyFigureLine {
  id?: string;
  kind?: string;
  points: StrategyFigurePoint[];
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed';
}

export interface StrategyFigurePoints {
  id?: string;
  kind?: string;
  points: StrategyFigurePoint[];
  color?: string;
  radius?: number;
}

export interface StrategyFigureZone {
  id?: string;
  kind?: string;
  start: StrategyFigurePoint;
  end: StrategyFigurePoint;
  color?: string;
  borderColor?: string;
}

export interface StrategyEntryModelFigures {
  lines?: StrategyFigureLine[];
  points?: StrategyFigurePoints[];
  zones?: StrategyFigureZone[];
}

export interface TrendLineOptions {
  mode: TrendLineMode;
  maxLines?: number; // ограничение перебора пар опор (кандидатов)
  range?: number; // окно для локальных экстремумов (в барах)
  epsilon?: number; // допуск как доля цены (0.01 = 1%) — применяется для касаний, фитилей между опорами и close-пробоев ДО offset
  epsilonOffset?: number; // размер окна в конце (в барах)
  minTouches?: number; // минимум касаний по телу (с учётом minTouchGap)
  minDistance?: number; // минимум баров между опорами/крайними касаниями
  firstRange?: number; // «сила» первой опоры (окно сильного экстремума)
  offset?: number; // размер окна в конце (в барах)
  minTouchGap?: number; // минимум баров между касаниями
  maxTouchGap?: number; // максимум баров между касаниями
  capture?: boolean; // true: в окне offset обязателен «старт за линией» и цвет свечи (строго, без допуска)
  bestLines?: number;
  maxDistance?: number;
}

export interface Signal {
  signalId: string;
  orderId?: string;
  symbol: string;
  interval: Interval;
  strategy: string;
  direction: Direction;
  timestamp: number;
  orderStatus?: SignalOrderStatus;
  orderSkipReason?: string;
  isConfigFromBacktest?: boolean;
  aiAnalysis?: Partial<SignalAnalysis>;
  ml?: {
    probability: number;
    threshold: number;
    passed: boolean;
  };
  figures: {
    trendLine?: TrendLine;
    lines?: StrategyFigureLine[];
    points?: StrategyFigurePoints[];
    zones?: StrategyFigureZone[];
    [key: string]: any;
  };
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  indicators: Record<string, any>;
  additionalIndicators?: Record<string, any>;
}

export type RuntimeSignalEvaluationStatus = 'signal' | 'skip' | 'error';

export interface RuntimeSignalEvaluationRecord {
  evaluationId: string;
  userName: string;
  strategy: string;
  symbol: string;
  interval: Interval;
  timestamp: number;
  evaluatedAt: number;
  status: RuntimeSignalEvaluationStatus;
  reason?: string;
  signalId?: string;
  direction?: Direction;
  orderStatus?: SignalOrderStatus;
  orderSkipReason?: string;
  aiAnalysis?: Partial<SignalAnalysis> | null;
  ml?: Signal['ml'];
}

export interface SignalAnalysis {
  direction: Direction | null;
  quality: 1 | 2 | 3 | 4 | 5 | number;
  needRetest: boolean;
  retestPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  setup?: string;
  confirmations?: string;
  btcContext?: string;
  retestPlan?: string;
  riskLevels?: string;
  qualityReason?: string;
  triggerInvalidation?: string;
  comment: string;
}

export interface RuntimeAiAnalysisSnapshot {
  strategy?: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  toleranceMs?: number;
  analysis: Partial<SignalAnalysis>;
}

export type SignalOrderStatus = 'completed' | 'failed' | 'skipped' | 'canceled';

export type RuntimeTradeStatus = 'active' | 'closed';

export interface RuntimeTradeRecord {
  orderId: string;
  signalId?: string;
  strategy: string;
  symbol: string;
  direction: Direction;
  qty: number;
  entryPrice: number;
  entryTimestamp: number;
  status: RuntimeTradeStatus;
  currentPrice?: number | null;
  currentPnl?: number | null;
  closedPnl?: number | null;
  exitPrice?: number | null;
  exitTimestamp?: number | null;
  aiAnalysis?: Partial<SignalAnalysis> | null;
  lastSyncedAt?: number;
}
