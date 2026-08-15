import type {
  Connector,
  Direction,
  Interval,
  KlineChartData,
  KlineChartItem,
  OrderPositionIntent,
  RuntimeAiAnalysisSnapshot,
  Signal,
  Tp,
} from './trade';
import type { StrategyConfig } from './backtest';
import type {
  BaseStrategyContextSnapshot,
  IndicatorsHistorySnapshot,
  StrategyDecisionPriceContext,
  StrategyIndicatorsContext,
} from './strategyContext';

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
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export interface StrategyAPIExitParams {
  code?: string;
  direction: Direction;
}

export interface StrategyProtectPlan {
  direction: Direction;
  stopLossPrice?: number | null;
  takeProfits?: Tp[];
}

export interface StrategyAPIProtectParams {
  code?: string;
  protectPlan: StrategyProtectPlan;
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

export type StrategySharedReplayStateGetter = <TState>(
  key: string | undefined,
  createState: () => TState,
) => TState;

export interface StrategyStateControllerOptions<TState, TSnapshot = TState> {
  sharedReplay?: boolean;
  configKey?: string;
  monotonic?: boolean;
  snapshot?: (state: TState) => TSnapshot;
  hash?: (snapshot: TSnapshot) => string;
}

export interface StrategyStateController<
  TState,
  TResult = unknown,
  TSnapshot = unknown,
> {
  get: () => TState;
  set: (state: TState) => void;
  update: (fn: (state: TState) => void) => TState;
  oncePerTimestamp: (
    timestamp: number,
    compute: (state: TState) => TResult,
  ) => TResult;
  snapshot: () => TSnapshot;
  hash: () => string;
}

export interface StrategyAPI<
  TIndicators = IndicatorsHistorySnapshot | Record<string, unknown>,
> {
  skip: (code: string) => Extract<StrategyDecision, { kind: 'skip' }>;
  entry: (
    params: StrategyAPIEntryParams,
  ) => Promise<Extract<StrategyDecision, { kind: 'entry' }>>;
  exit: (
    params: StrategyAPIExitParams,
  ) => Promise<Extract<StrategyDecision, { kind: 'exit' }>>;
  protect: (
    params: StrategyAPIProtectParams,
  ) => Extract<StrategyDecision, { kind: 'protect' }>;
  getCurrentIndicatorsContext: () => StrategyIndicatorsContext<TIndicators>;
  getBaseContext: () => BaseStrategyContextSnapshot | undefined;
  getDecisionBaseContext: () => Promise<
    BaseStrategyContextSnapshot | undefined
  >;
  getDecisionPriceContext: () => Promise<StrategyDecisionPriceContext>;
  getCurrentPosition: () => ReturnType<Connector['getPosition']>;
  getDirectionalTpSlPrices: (
    params: StrategyDirectionalTpSlParams,
  ) => StrategyDirectionalTpSlResult;
  createLastTradeController: (
    params?: StrategyLastTradeControllerParams,
  ) => StrategyLastTradeController;
  createStateController: <TState, TResult = unknown, TSnapshot = TState>(
    key: string,
    createState: () => TState,
    options?: StrategyStateControllerOptions<TState, TSnapshot>,
  ) => StrategyStateController<TState, TResult, TSnapshot>;
}

export interface StrategyIndicatorsState<
  TNext = unknown,
  TSnapshot = Record<string, any> | undefined,
> {
  isInitialized: () => boolean;
  setCurrentBar: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => void;
  updateReferenceData?: (params: {
    btcBinanceData?: KlineChartData;
    btcCoinbaseData?: KlineChartData;
  }) => void;
  onBar: (
    candle?: KlineChartData[number],
    btcCandle?: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => void;
  next: (
    candle: KlineChartData[number],
    btcCandle: KlineChartData[number],
    ethCandle?: KlineChartData[number],
  ) => TNext;
  ensureInitializedWithCurrentBar: () => {
    snapshot: (options?: { compact?: boolean; limit?: number }) => TSnapshot;
  };
  snapshot: (options?: { compact?: boolean; limit?: number }) => TSnapshot;
  latestSnapshot?: () => TNext;
  latestNumber: <K extends Extract<keyof NonNullable<TSnapshot>, string>>(
    key: K,
  ) => number | undefined;
  latestNumbers: <K extends Extract<keyof NonNullable<TSnapshot>, string>>(
    key: K,
    count: number,
  ) => number[];
}

export interface StrategyRuntimeMlOptions {
  enabled?: boolean;
  modelKey?: string;
  strategyConfig?: StrategyConfig;
  mlThreshold?: number;
}

export type StrategyAiMode = 'gate' | 'llm';

export interface StrategyRuntimeAiOptions {
  enabled?: boolean;
  mode?: StrategyAiMode;
  minQuality?: number;
  replayAnalyses?: RuntimeAiAnalysisSnapshot[];
}

export interface StrategyEntryRuntimeOptions {
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
  beforePlaceOrder?: () => Promise<void>;
}

export interface StrategyEntryOrderPlan {
  qty: number;
  stopLossPrice: number;
  takeProfits: Tp[];
  positionIntent?: OrderPositionIntent;
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
    }
  | {
      kind: 'protect';
      code: string;
      protectPlan: StrategyProtectPlan;
    };

export interface CreateStrategyCoreParams<
  TConfig extends StrategyConfig,
  TIndicatorsState extends StrategyIndicatorsState = StrategyIndicatorsState,
> {
  config: TConfig;
  data: KlineChartData;
  strategyApi: StrategyAPI<
    TIndicatorsState extends StrategyIndicatorsState<any, infer TSnapshot>
      ? TSnapshot
      : never
  >;
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
