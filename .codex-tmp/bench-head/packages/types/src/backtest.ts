import { Metrics, MetricThreshold } from './metrics';
import {
  Candle,
  KlineChartItem,
  Direction,
  Connector,
  KlineRequest,
  KlineChartData,
  Order,
  OrderType,
} from './trade';
import { Signal } from './trade';

export type Strategy = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
) => Promise<string | Signal>;

export type BacktestPriceMode = 'mid' | 'close' | 'open' | 'rand';

export interface StrategyConfig {
  BACKTEST_PRICE_MODE?: BacktestPriceMode;
  ML_ENABLED?: boolean;
  [key: string]: any;
}
export type StrategyResultConfig = StrategyConfig;
export type StrategyConfigGrid = Record<string, unknown[]>;

export interface StrategyCreatorParams {
  userName: string;
  symbol: string;
  config: StrategyConfig;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
}

export type StrategyCreator = (
  params: StrategyCreatorParams,
) => Promise<Strategy>;

export type TestingOptions = Pick<KlineRequest, 'start' | 'end'>;

export interface BacktestRunConfig {
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export interface Test extends BacktestRunConfig {
  userName: string;
  name: string;
  testId: string;
  testSuiteId: string;
  symbol: string;
  options: TestingOptions;
  ml?: boolean;
  ai?: boolean;
  chunkId?: string;
}

export type TestSuite = Test[];

export interface TestStat extends Metrics {
  score?: number;
}

export interface StrategyResultEntry {
  config: StrategyResultConfig;
  stats: TestStat;
}

export type StrategyResults = Record<string, StrategyResultEntry>;

export interface MinimalStat {
  amount: number;
  profit: number;
  orders: number;
}

export interface TestingBoxResult {
  orderLogId: string;
  stat: MinimalStat;
}

export type TestingBox = (test: Test) => Promise<TestingBoxResult | null>;

export interface TestWorkerResult extends TestingBoxResult {
  test: Test;
}

export interface CompletedTest extends Omit<TestWorkerResult, 'stat'> {
  stat: TestStat;
}

export type OrderLog = Order & {
  type: OrderType;
  profit: number;
  amount: number;
  fee?: number;
  index: number;
};

export type OrderLogData = OrderLog[];

export type SimpleOrderLogData = [number, number][];

export interface TestResult extends Omit<CompletedTest, 'orderLogId'> {
  orderLog: SimpleOrderLogData;
}

export interface PositionLog {
  direction: Direction;
  open: { amount: number; timestamp: number };
  close: { amount: number; timestamp: number };
}

export type PositionLogData = PositionLog[];

export type TestThresholds = Record<keyof TestStat, MetricThreshold>;

export type TestThresholdsKey = keyof TestThresholds;

export interface TestConnector extends Connector {
  getResult: () => Promise<TestingBoxResult>;
  checkTp: (candle: Candle) => Promise<void>;
  checkSl: (candle: Candle) => Promise<void>;
  drainMlResultsBatch: () => Promise<
    Array<{ signalId: string; profit: number }>
  >;
}

export interface TestConnectorContext {
  userName?: string;
  mlEnabled?: boolean;
  aiEnabled?: boolean;
}

export type TestConnectorCreator = (
  connector: Connector,
  context?: TestConnectorContext,
) => TestConnector;

export type ChartColor = string;
export interface TestCompare {
  testResult: TestResult;
  color: ChartColor;
}

export type TestCompareList = TestCompare[];

export type OnChangeCompare = (testId: string) => void;
