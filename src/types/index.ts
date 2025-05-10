import { KlineIntervalV3 } from 'bybit-api';

export type Interval = KlineIntervalV3;

export interface KlineChartItem {
  dt: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  [key: string]: unknown;
}

export type KlineChartData = Array<KlineChartItem>;

export interface KlineRequest {
  symbol: string;
  interval: Interval;
  start?: number;
  end: number;
}

export type Strategy = (
  symbol: string,
  timestamp: number,
  connector: Connector,
) => Promise<void>;

export type StrategyCreator = (config: StrategyConfig) => Strategy;

export type TestingOptions = Omit<KlineRequest, 'interval'>;

export interface Tp {
  profit: number;
  rate: number;
  done?: boolean;
}

export type Sl = number | null;

export type StrategyConfig = Record<string, any>;

export type TestingBox = (
  id: string,
  strategyCreator: StrategyCreator,
  options: TestingOptions,
  config: StrategyConfig,
) => Promise<ConnectorStat>;

export type TestConfig = {
  name: string;
  strategy: StrategyCreator;
  options: TestingOptions;
  strategyConfig: StrategyConfig;
}[];

type Direction = 'LONG' | 'SHORT';

export type Order = {
  symbol: string;
  qty: number;
  price: number;
  timestamp: number;
};

export interface OrderWithDirection extends Order {
  direction: Direction;
}

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

export type OrderLog = Order & {
  type: OrderType;
  profit: number;
  index: number;
};

export type OrderLogData = OrderLog[];

export interface ConnectorStat {
  amount: number;
  orders: number;
  minAmount: number;
}

export type ConnectorCreator = (config: ConnectorConfig) => Connector;
export type TestConnectorCreator = (config: ConnectorConfig) => TestConnector;

export interface ConnectorConfig {
  key: string;
  secret: string;
}

interface Bot {
  symbol: string;
  strategy: Strategy;
}

export type BotConfig = Bot[];

type GetPosition = (symbol: string) => Promise<Position | null>;
type PlaceOrder = (
  order: OrderWithDirection,
  tp?: Tp[],
  sl?: Sl,
) => Promise<boolean>;
type ClosePosition = (order: Omit<Order, 'qty'>) => Promise<boolean>;
export type Kline = (options: KlineRequest) => Promise<KlineChartData>;
export type GetTickers = () => Promise<Ticker[]>;

export interface Connector {
  kline: Kline;
  getPosition: GetPosition;
  placeOrder: PlaceOrder;
  closePosition: ClosePosition;
  getTickers: GetTickers;
}

export interface TestConnector extends Connector {
  getStat: () => ConnectorStat;
  saveStat: (symbol: string, id: string) => void;
  checkTp: (symbol: string, start: number, end: number) => Promise<void>;
  checkSl: (symbol: string, start: number, end: number) => Promise<void>;
}

export interface Indicators {
  vol: {
    enabled: boolean;
  };
  atr: {
    enabled: boolean;
    periods: Array<number>;
  };
  ma: {
    enabled: boolean;
    periods: Array<number>;
  };
  ema: {
    enabled: boolean;
    periods: Array<number>;
  };
  wma: {
    enabled: boolean;
    periods: Array<number>;
  };
}

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

export interface Item {
  label: string;
  value: string;
  description?: string;
}

export type Items = Item[];

export interface Figure {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  color: string;
  width: number;
  height: number;
}
