import { Tokens } from '@chakra-ui/react';
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
import { Signal } from './signals';

export type Strategy = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
) => Promise<string | Signal>;

export type StrategyConfig = Record<string, any>;

export interface StrategyCreatorParams {
  symbol: string;
  config: StrategyConfig;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
}

export type StrategyCreator = (params: StrategyCreatorParams) => Strategy;

export type TestingOptions = Pick<KlineRequest, 'start' | 'end'>;

export interface BacktestConfig {
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export interface Test extends BacktestConfig {
  userName: string;
  name: string;
  testId: string;
  testSuiteId: string;
  symbol: string;
  options: TestingOptions;
}

export type TestSuite = Test[];

export interface TestStat extends Metrics {
  score?: number;
}

export interface MinimalStat {
  amount: number;
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
  checkTp: (candle: Candle) => void;
  checkSl: (candle: Candle) => void;
}

export type TestConnectorCreator = (connector: Connector) => TestConnector;

export type ChartColor = Tokens['colors'] | React.CSSProperties['color'];
export interface TestCompare {
  testResult: TestResult;
  color: ChartColor;
}

export type TestCompareList = TestCompare[];

export type OnChangeCompare = (testId: string) => void;
