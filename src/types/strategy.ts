import {
  Connector,
  Direction,
  Interval,
  KlineChartData,
  KlineChartItem,
  Signal,
  Tp,
  Candle,
} from './trade';
import { BacktestPriceMode, StrategyConfig } from './backtest';

export interface StrategySignalMetaParams {
  symbol: string;
  interval: Interval;
  direction: Direction;
  timestamp: number;
  isConfigFromBacktest: boolean;
}

export interface StrategySignalPriceParams {
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
}

export interface StrategyEntryBaseParams {
  qty: number;
}

export interface StrategyEntryTakeProfitsParams {
  takeProfits: Tp[];
}

export interface StrategyEntryRuntimeBaseParams {
  symbol: string;
  direction: Direction;
  timestamp: number;
  currentPrice: number;
}

export type StrategyEntryRuntimeBuilderParams<TExtra extends object = {}> =
  StrategyEntryRuntimeBaseParams & TExtra;

export type StrategyEntrySignalDecisionBuilderParams<
  TPriceFields extends object = StrategySignalPriceParams,
  TExtra extends object = {},
> = StrategySignalMetaParams & StrategyEntryBaseParams & TPriceFields & TExtra;

export type StrategyIndicatorsMap = Signal['indicators'];
export type StrategyAdditionalIndicatorsMap = NonNullable<
  Signal['additionalIndicators']
>;

export interface BuildStrategySignalParams {
  signalId: string;
  strategy: Signal['strategy'];
  symbol: string;
  interval: Signal['interval'];
  direction: Direction;
  timestamp: number;
  prices: Signal['prices'];
  figures?: Signal['figures'];
  indicators?: Signal['indicators'];
  additionalIndicators?: NonNullable<Signal['additionalIndicators']>;
  isConfigFromBacktest?: boolean;
}

export type BuildStrategySignalDraft = Omit<
  BuildStrategySignalParams,
  'signalId'
> & {
  signalId?: string;
};

export interface StrategyEntrySignalContext {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  direction: Signal['direction'];
  timestamp: Signal['timestamp'];
  prices: Signal['prices'];
  isConfigFromBacktest?: Signal['isConfigFromBacktest'];
}

export interface StrategyAPIEntryParams {
  code?: string;
  direction: Direction;
  timestamp: Signal['timestamp'];
  prices: Signal['prices'];
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export interface StrategyAPIMarketDataParams {
  preloadStart?: number;
  backtestPriceMode?: BacktestPriceMode;
}

export interface StrategyMarketSnapshot {
  fullData: KlineChartData;
  lastCandle: KlineChartItem;
  timestamp: number;
  currentPrice: number;
}

export interface MlCandleIndicatorsSnapshot {
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  candles1d: Candle[];
  btcCandles15m: Candle[];
  btcCandles1h: Candle[];
  btcCandles4h: Candle[];
  btcCandles1d: Candle[];
}

export interface BaseIndicatorsHistorySnapshot {
  maFast?: number[];
  maMedium?: number[];
  maSlow?: number[];
  atr?: number[];
  atrPct?: number[];
  bbUpper?: number[];
  bbMiddle?: number[];
  bbLower?: number[];
  obv?: number[];
  smaObv?: number[];
  macd?: number[];
  macdSignal?: number[];
  macdHistogram?: number[];
  price24hPcnt?: number[];
  price1hPcnt?: number[];
  highPrice1h?: number[];
  lowPrice1h?: number[];
  volume1h?: number[];
  highPrice24h?: number[];
  lowPrice24h?: number[];
  volume24h?: number[];
  highLevel?: number[];
  lowLevel?: number[];
  prevClose?: number[];
  correlation?: number[];
}

export type IndicatorsHistorySnapshot = Record<string, number[] | Candle[]> &
  BaseIndicatorsHistorySnapshot &
  Partial<MlCandleIndicatorsSnapshot>;

export interface IndicatorSnapshot {
  maFast: number;
  maMedium: number;
  maSlow: number;
  atr: number;
  atrPct: number | null;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  obv: number;
  smaObv: number;
  macd: number | undefined;
  macdSignal: number | undefined;
  macdHistogram: number | undefined;
  price24hPcnt: number;
  price1hPcnt: number;
  highPrice1h: number | null;
  lowPrice1h: number | null;
  volume1h: number | null;
  highPrice24h: number | null;
  lowPrice24h: number | null;
  volume24h: number | null;
  candle: Candle;
  prevCandle: Candle | null;
  highLevel: number | null;
  lowLevel: number | null;
  correlation: number;
}

export interface StrategyDirectionalTpSlParams {
  price: number;
  direction: Direction;
  takeProfitDelta: number;
  stopLossDelta: number;
  unit?: 'percent' | 'ratio';
  maxLossValue?: number;
  feePercent?: number;
}

export interface StrategyDirectionalTpSlResult {
  stopLossPrice: number;
  takeProfitPrice: number;
  riskRatio: number;
  qty?: number;
}

export interface StrategyLastTradeController {
  isInCooldown: (timestamp: number) => boolean;
  markTrade: (timestamp: number) => void;
  getLastTradeTimestamp: () => number | null;
}

export interface StrategyLastTradeControllerParams {
  env?: string;
  enabled?: boolean;
  cooldownMs?: number;
}

export interface StrategyAPI {
  skip: (code: string) => Extract<StrategyDecision, { kind: 'skip' }>;
  entry: (
    params: StrategyAPIEntryParams,
  ) => Extract<StrategyDecision, { kind: 'entry' }>;
  getMarketData: (
    params?: StrategyAPIMarketDataParams,
  ) => Promise<StrategyMarketSnapshot>;
  nextIndicators: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => unknown;
  getCurrentPosition: () => ReturnType<Connector['getPosition']>;
  isCurrentPositionExists: () => Promise<boolean>;
  getDirectionalTpSlPrices: (
    params: StrategyDirectionalTpSlParams,
  ) => StrategyDirectionalTpSlResult;
  createLastTradeController: (
    params?: StrategyLastTradeControllerParams,
  ) => StrategyLastTradeController;
}

export interface StrategyIndicatorsState<
  TNext = unknown,
  TSnapshot = Record<string, any> | undefined,
> {
  isInitialized: () => boolean;
  setCurrentBar: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => void;
  onBar: (
    candle?: KlineChartData[number],
    btcCandle?: KlineChartData[number],
  ) => void;
  next: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
  ) => TNext;
  ensureInitializedWithCurrentBar: () => { snapshot: () => TSnapshot };
  snapshot: () => TSnapshot;
  latestNumber: <K extends Extract<keyof NonNullable<TSnapshot>, string>>(
    key: K,
  ) => number | undefined;
}

export interface StrategyRuntimeMlOptions {
  enabled?: boolean;
  strategyConfig?: StrategyConfig;
  mlThreshold?: number;
}

export interface StrategyRuntimeAiOptions {
  enabled?: boolean;
  minQuality?: number;
}

export interface StrategyEntryRuntimeOptions {
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
  beforePlaceOrder?: () => Promise<void>;
}

export interface StrategyEntryOrderPlan {
  qty: number;
  takeProfits?: Tp[];
}

export interface StrategyClosePlan {
  price: number;
  timestamp: number;
  direction: Direction;
}

export type StrategyDecision =
  | {
      kind: 'skip';
      code: string;
    }
  | {
      kind: 'entry';
      code: string;
      entryContext: StrategyEntrySignalContext;
      orderPlan: StrategyEntryOrderPlan;
      signal?: Signal;
      runtime?: StrategyEntryRuntimeOptions;
    }
  | {
      kind: 'exit';
      code: string;
      closePlan: StrategyClosePlan;
    };

export interface CreateStrategyCoreParams<
  TConfig extends StrategyConfig,
  TIndicatorsState extends StrategyIndicatorsState = StrategyIndicatorsState,
> {
  userName: string;
  symbol: string;
  config: TConfig;
  isConfigFromBacktest: boolean;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
  strategyApi: StrategyAPI;
  indicatorsState: TIndicatorsState;
}

export type StrategyCoreRunner = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
) => Promise<StrategyDecision> | StrategyDecision;

export type CreateStrategyCore<
  TConfig extends StrategyConfig,
  TSnapshot extends Record<string, any> | undefined =
    | Record<string, any>
    | undefined,
  TNext = unknown,
> = (
  params: CreateStrategyCoreParams<
    TConfig,
    StrategyIndicatorsState<TNext, TSnapshot>
  >,
) => Promise<StrategyCoreRunner> | StrategyCoreRunner;
