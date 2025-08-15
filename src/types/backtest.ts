import { Tokens } from '@chakra-ui/react';
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

export type TestingOptions = Pick<KlineRequest, 'start' | 'end'>;

export interface Test {
  name: string;
  testId: string;
  testSuiteId: string;
  symbol: string;
  options: TestingOptions;
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export type TestSuite = Test[];

export interface TestStat extends Metrics {
  score?: number;
}

export interface TestingBoxResult {
  orderLogId: string;
  stat: TestStat;
}

export type TestingBox = (test: Test) => Promise<TestingBoxResult | null>;

export interface TestWorkerResult extends TestingBoxResult {
  test: Test;
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

export interface TestResult extends Omit<TestWorkerResult, 'orderLogId'> {
  orderLog: SimpleOrderLogData;
}

export interface PositionLog {
  open: { amount: number; timestamp: number };
  close: { amount: number; timestamp: number };
}

export type PositionLogData = PositionLog[];

export type TestThresholds = Record<keyof TestStat, MetricThreshold>;

export type TestThresholdsKey = keyof TestThresholds;

export interface TestConnector extends Connector {
  getResult: () => Promise<TestingBoxResult | null>;
  checkTp: (candle: Candle) => void;
  checkSl: (candle: Candle) => void;
}

export type TestConnectorCreator = (connector: Connector) => TestConnector;

export type ChartColor = Tokens['colors'] | React.CSSProperties['color'];
export interface TestCompare {
  testId: string;
  orderLog: SimpleOrderLogData;
  color: ChartColor;
}

export type TestCompareList = TestCompare[];

export type OnChangeCompare = (
  testId: string,
  orderLog: SimpleOrderLogData | null,
) => void;
