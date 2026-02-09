import { KlineIntervalV3 } from 'bybit-api';

export type Interval = KlineIntervalV3;

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
}

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
  signal?: Signal;
};

export type Position = {
  symbol: string;
  qty: number;
  price: number;
  direction: Direction;
};

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

type GetPosition = (symbol: string) => Promise<Position | null>;
type GetPositions = () => Promise<Position[]>;
type PlaceOrder = (order: Order, tp?: Tp[], slPrice?: Sl) => Promise<boolean>;
type ClosePosition = (order: Omit<Order, 'qty'>) => Promise<boolean>;
export type Kline = (options: KlineRequest) => Promise<KlineChartData>;
export type GetTickers = () => Promise<Ticker[]>;

export interface Connector {
  kline: Kline;
  getState: () => Promise<object>;
  setState: (state: object) => Promise<void>;
  getPosition: GetPosition;
  getPositions: GetPositions;
  placeOrder: PlaceOrder;
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
  symbol: string;
  interval: Interval;
  strategy: string;
  direction: Direction;
  timestamp: number;
  trendlineFrom?: 'engine' | 'batch';
  configFromBacktest?: boolean;
  ml?: {
    probability: number;
    threshold: number;
    passed: boolean;
  };
  figures: {
    trendLine?: TrendLine;
  };
  prices: {
    currentPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    riskRatio: number;
  };
  indicators: Record<string, any>;
}
