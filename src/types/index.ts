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

export type Strategy = (
  symbol: string,
  candle: Candle,
  connector: Connector,
) => Promise<string>;

export type StrategyCreator = (
  config: StrategyConfig,
  data: KlineChartData,
) => Strategy;

export type TestingOptions = Omit<KlineRequest, 'interval' | 'symbol'>;

export interface Tp {
  profit: number;
  rate: number;
  done?: boolean;
}

export type Sl = number | null;

export type StrategyConfig = Record<string, any>;

export interface Test {
  name: string;
  symbol: string;
  options: TestingOptions;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
  connector: Connector;
}

export type TestingBox = (test: Test) => Promise<ConnectorStat>;

export type TestItem = {
  name: string;
  symbol: string;
  options: TestingOptions;
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
};

export type TestConfig = TestItem[];

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

export type OrderLog = Order & {
  type: OrderType;
  profit: number;
  amount: number;
  index: number;
};

export type OrderLogData = OrderLog[];

export interface ConnectorStat {
  amount: number;
  orders: number;
  wins: number;
  losses: number;
  ws: number;
  minAmount: number;
  orderLog: OrderLogData | string;
}

export interface BacktestStat extends ConnectorStat {
  ind: number;
  id: string;
  symbol: string;
  orderLogId: string;
  config: StrategyConfig;
}

export type ConnectorCreator = (config: ConnectorConfig) => Connector;
export type TestConnectorCreator = (connector: Connector) => TestConnector;

export interface ConnectorConfig {
  key: string;
  secret: string;
}

interface Bot {
  symbol: string;
  disabled?: boolean;
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export interface BotStatus {
  symbol: string;
  status: string;
}

export type BotResults = Array<BotStatus>;

export type BotConfig = Bot[];

type GetPosition = (symbol: string) => Promise<Position | null>;
type PlaceOrder = (order: Order, tp?: Tp[], sl?: Sl) => Promise<boolean>;
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
  checkTp: (candle: Candle) => void;
  checkSl: (candle: Candle) => void;
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
