import { Metrics, MetricThreshold } from './metrics';
import {
  Candle,
  Connector,
  KlineRequest,
  KlineChartData,
  Order,
  OrderType,
} from './trade';

export type Strategy = (
  symbol: string,
  candle: Candle,
  connector: Connector,
) => Promise<string>;

export type StrategyConfig = Record<string, any>;

export type StrategyCreator = (
  config: StrategyConfig,
  data: KlineChartData,
) => Strategy;

export type TestingOptions = Omit<KlineRequest, 'interval' | 'symbol'>;

interface Test {
  name: string;
  symbol: string;
  options: TestingOptions;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
  connector: Connector;
}

export type TestingBox = (test: Test) => Promise<BacktestResult>;

export interface TestItem {
  name: string;
  symbol: string;
  options: TestingOptions;
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export type TestConfig = TestItem[];

export type OrderLog = Order & {
  type: OrderType;
  profit: number;
  amount: number;
  fee?: number;
  index: number;
};

export type OrderLogData = OrderLog[];

export interface PositionLog {
  open: { amount: number; timestamp: number };
  close: { amount: number; timestamp: number };
}

export type PositionLogData = PositionLog[];

export interface BacktestResult {
  orderLog: OrderLogData;
  stat: BacktestStat | null;
}

export interface BacktestHistory extends BacktestResult {
  strategyConfig: StrategyConfig;
}

export interface BacktestStat extends Metrics {
  score?: number;
}

export type BacktestThresholds = Record<keyof BacktestStat, MetricThreshold>;

export interface WorkerResult {
  test: TestItem;
  orderLogId: string;
  stat: BacktestStat;
}

export interface TestConnector extends Connector {
  getResult: () => BacktestResult;
  checkTp: (candle: Candle) => void;
  checkSl: (candle: Candle) => void;
}

export type TestConnectorCreator = (connector: Connector) => TestConnector;
