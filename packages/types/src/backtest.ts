import { Metrics, MetricThreshold } from './metrics';
import {
  Candle,
  Interval,
  KlineChartItem,
  Direction,
  Connector,
  KlineRequest,
  KlineChartData,
  Order,
  OrderType,
  RuntimeStrategyCloseNotification,
  RuntimeSignalEvaluationRecord,
  Signal,
} from './trade';
import type {
  AssetClass,
  FundingRatePoint,
  InstrumentDescriptor,
  MarketUniverse,
} from './market';

export type ExecutionCostSource =
  | 'exchange-account'
  | 'connector-default'
  | 'config'
  | 'historical'
  | 'calibrated'
  | 'fallback'
  | 'disabled'
  | 'unavailable';

export type ExecutionCostQuality = 'full' | 'partial' | 'fallback';

export interface ExecutionCostModel {
  fees: {
    makerRate: number;
    takerRate: number;
    source: ExecutionCostSource;
  };
  funding: {
    enabled: boolean;
    source: ExecutionCostSource;
    points?: number;
    fromTimestamp?: number | null;
    toTimestamp?: number | null;
  };
  slippage: {
    baseBps: number;
    spreadMultiplier: number;
    marketImpactBps: number;
    delayRiskMultiplier: number;
    source: ExecutionCostSource;
  };
  leverage: {
    requested: number;
    effective: number;
    maxAllowed: number | null;
  };
  quality: ExecutionCostQuality;
  capturedAt: number;
}

export type Strategy = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
  ethCandle?: KlineChartItem,
) => Promise<string | Signal>;

export type BacktestDetectorOptimizedStrategy = Strategy & {
  detectorFanoutKey?: string;
  detectorNoSignalSkipReason?: string;
  canFastAdvanceDetectorNoSignal?: boolean;
  advanceDetectorNoSignal?: (
    candle: KlineChartItem,
    btcCandle: KlineChartItem,
    code: string,
  ) => Promise<string | Signal>;
  skipDetectorNoSignal?: (
    candle: KlineChartItem,
    btcCandle: KlineChartItem,
    code: string,
  ) => Promise<string | Signal>;
};

export type BacktestPriceMode = 'mid' | 'close' | 'open';

export interface StrategyConfig {
  BACKTEST_PRICE_MODE?: BacktestPriceMode;
  BACKTEST_ENTRY_DELAY_BARS?: number;
  BACKTEST_EXECUTION_INTERVAL?: Interval;
  BACKTEST_EXECUTION_DELAY_MS?: number;
  ML_ENABLED?: boolean;
  POLICY_PROFILE_ID?: string;
  MAKER_FEE_RATE?: number;
  TAKER_FEE_RATE?: number;
  FUNDING_ENABLED?: boolean;
  LEVERAGE?: number;
  SLIPPAGE_BASE_BPS?: number;
  SLIPPAGE_SPREAD_MULTIPLIER?: number;
  SLIPPAGE_MARKET_IMPACT_BPS?: number;
  SLIPPAGE_DELAY_RISK_MULTIPLIER?: number;
  EXECUTION_COSTS_CACHE_ONLY?: boolean;
  [key: string]: any;
}
export type StrategyResultConfig = StrategyConfig;
export type StrategyConfigGrid = Record<string, unknown[]>;

export interface StrategyCreatorParams {
  userName: string;
  connectorName: string;
  symbol: string;
  universe?: MarketUniverse;
  assetClass?: AssetClass;
  instrument?: InstrumentDescriptor;
  accountId?: string;
  deploymentId?: string;
  policyProfileId?: string;
  config: StrategyConfig;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
  ethData?: KlineChartData;
  btcBinanceData?: KlineChartData;
  btcCoinbaseData?: KlineChartData;
  backtestExecutionMarketData?: {
    interval: Interval;
    data: KlineChartData;
    btcData?: KlineChartData;
    dataByTimestamp?: Map<number, KlineChartItem>;
    btcDataByTimestamp?: Map<number, KlineChartItem>;
  };
  sharedIndicatorsReplayKey?: string;
  sharedStrategyStateKey?: string;
  onRuntimeClose?: (event: RuntimeStrategyCloseNotification) => void;
}

export interface StrategyCreator {
  (params: StrategyCreatorParams): Promise<Strategy>;
  detectorKey?: (config: StrategyConfig) => string | undefined;
  detectorNoSignalSkipReason?: string;
}

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
  configId?: string;
  symbol: string;
  universe?: MarketUniverse;
  assetClass?: AssetClass;
  instrument?: InstrumentDescriptor;
  accountId?: string;
  deploymentId?: string;
  policyProfileId?: string;
  executionCostModel?: ExecutionCostModel;
  interval?: Interval;
  options: TestingOptions;
  ml?: boolean;
  ai?: boolean;
  fast?: boolean;
  collectReplaySignalEvaluations?: boolean;
  chunkId?: string;
  backtestRunId?: string;
  backtestTestKey?: string;
  timeoutMs?: number;
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
  inlineOrderLog?: OrderLogData;
  inlinePositionLog?: PositionLogData;
  inlineReplaySignalEvaluations?: RuntimeSignalEvaluationRecord[];
  executionCostModel?: ExecutionCostModel;
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
  executionSlippageStage?: 'entry' | 'exit';
  executionSlippageBps?: number | null;
  executionBaseSlippageBps?: number | null;
  executionSpreadBps?: number | null;
  executionSpreadSlippageBps?: number | null;
  executionMarketImpactBps?: number | null;
  executionDelayRiskBps?: number | null;
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
  checkExits: (candle: Candle) => Promise<void>;
  drainMlResultsBatch: () => Promise<TestClosedSignalResult[]>;
}

export type TestTradeExitReason = 'take_profit' | 'stop_loss' | 'exit';

export interface TestTradeResult {
  signalId: string;
  direction: Direction;
  qty: number;
  closedQty: number;
  entryTimestamp: number;
  exitTimestamp: number;
  exitReason: TestTradeExitReason;
  requestedEntryPrice: number;
  entryPrice: number;
  requestedExitPrice: number | null;
  exitPrice: number | null;
  grossProfit: number;
  netProfit: number;
  openFee: number;
  closeFee: number;
  fundingFee: number | null;
  totalFee: number;
  entrySlippagePrice: number;
  entrySlippageBps: number;
  entryBaseSlippageBps: number;
  entrySpreadBps: number;
  entrySpreadSlippageBps: number;
  entryMarketImpactBps: number;
  entryDelayRiskBps: number | null;
  entrySlippageCost: number;
  exitSlippagePrice: number | null;
  exitSlippageBps: number | null;
  exitBaseSlippageBps: number | null;
  exitSpreadBps: number | null;
  exitSpreadSlippageBps: number | null;
  exitMarketImpactBps: number | null;
  exitDelayRiskBps: number | null;
  exitSlippageCost: number;
  totalSlippageCost: number;
}

export interface TestClosedSignalResult {
  signalId: string;
  profit: number;
  tradeResult?: TestTradeResult;
}

export interface TestConnectorContext {
  userName?: string;
  mlEnabled?: boolean;
  aiEnabled?: boolean;
  fastMode?: boolean;
  executionCostModel?: ExecutionCostModel;
  fundingRates?: FundingRatePoint[];
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
