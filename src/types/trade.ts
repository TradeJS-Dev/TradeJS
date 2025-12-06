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
  profit?: number;
  price?: number;
  rate: number;
  done?: boolean;
}

export type Sl = number | null;

export type Direction = 'LONG' | 'SHORT';

export type Order = {
  symbol: string;
  qty: number;
  price: number;
  timestamp: number;
  direction: Direction;
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

export type ConnectorCreator = (config: ConnectorConfig) => Connector;

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
