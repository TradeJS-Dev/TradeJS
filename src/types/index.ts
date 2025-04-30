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

export interface Tpl {
  profit: number;
  rate: number;
  done?: boolean;
}

type TplConfig = {
  tpl: Tpl[];
};

export type StrategyConfig = Record<string, any> & TplConfig;

export type TestingBox = (
  id: string,
  strategyCreator: StrategyCreator,
  options: TestingOptions,
  config: StrategyConfig,
) => Promise<ConnectorStat>;

export type TestConfig = {
  options: TestingOptions;
  strategyConfig: StrategyConfig;
}[];

export type Order = {
  symbol: string;
  qty: number;
  price: number;
  timestamp: number;
};

export type Position = {
  symbol: string;
  qty: number;
  price: number;
};

export type OrderLog = Order & {
  type: 'BUY' | 'SELL';
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
type PlaceOrder = (order: Order, tpl: Tpl[]) => Promise<boolean>;
type ClosePosition = (order: Omit<Order, 'qty'>) => Promise<boolean>;
export type Kline = (options: KlineRequest) => Promise<KlineChartData>;

export interface Connector {
  kline: Kline;
  getPosition: GetPosition;
  placeOrder: PlaceOrder;
  closePosition: ClosePosition;
}

export interface TestConnector extends Connector {
  getStat: () => ConnectorStat;
  saveStat: (symbol: string, id: string) => void;
  checkTpl: (symbol: string, timestamp: number) => void;
}

export interface Indicators {
  vol: {
    enabled: boolean;
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

export interface BacktestConfig {
  enabled: boolean;
  symbol: string;
  id: string;
}

export interface Filters {
  symbol: string;
  interval: Interval;
  start: number;
  end: number;
}
