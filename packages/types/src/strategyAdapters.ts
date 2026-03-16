import {
  StrategyDecision,
  StrategyEntryRuntimeOptions,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
} from './strategy';
import { StrategyConfig } from './backtest';
import { Connector, KlineChartItem, Signal } from './trade';

export interface AiPayload {
  signal: {
    symbol: Signal['symbol'];
    signalId: Signal['signalId'];
    interval: Signal['interval'];
    direction: Signal['direction'];
    timestamp: Signal['timestamp'];
    strategy: Signal['strategy'];
    prices: {
      currentPrice: Signal['prices']['currentPrice'];
      takeProfitPrice: Signal['prices']['takeProfitPrice'];
      stopLossPrice: Signal['prices']['stopLossPrice'];
    };
  };
  figures: Record<string, unknown>;
  indicators: unknown;
  additionalIndicators: unknown;
}

export interface StrategyAiAdapter {
  buildPayload?: (params: {
    signal: Signal;
    basePayload: AiPayload;
  }) => AiPayload;
  buildSystemPromptAddon?: (params: { signal: Signal }) => string;
  buildHumanPromptAddon?: (params: {
    signal: Signal;
    payload: AiPayload;
  }) => string;
  mapEntryRuntimeFromConfig?: (
    config: StrategyConfig,
  ) => StrategyRuntimeAiOptions | undefined;
}

export interface StrategyMlAdapter {
  normalizeSignal?: (signal: Signal) => Signal;
  normalizeStrategyConfig?: (
    strategyConfig?: Record<string, any>,
  ) => Record<string, any> | undefined;
  mapEntryRuntimeFromConfig?: (
    config: StrategyConfig,
  ) => StrategyRuntimeMlOptions | undefined;
}

export interface StrategyHookGateResult {
  allow?: boolean;
  reason?: string;
}

export interface StrategyHookBaseContext {
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  config: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}

export type StrategyHookStage =
  | 'onInit'
  | 'afterCoreDecision'
  | 'onSkip'
  | 'beforeClosePosition'
  | 'afterEnrichMl'
  | 'afterEnrichAi'
  | 'beforeEntryGate'
  | 'beforePlaceOrder'
  | 'afterPlaceOrder'
  | 'runtime.beforePlaceOrder'
  | 'enrichSignalWithMl'
  | 'enrichSignalWithAi'
  | 'closePosition'
  | 'placeOrder';

export interface StrategyHookErrorContext extends StrategyHookBaseContext {
  stage: StrategyHookStage;
  error: unknown;
  decision?: StrategyDecision;
  signal?: Signal;
}

export interface StrategyHookInitContext extends StrategyHookBaseContext {
  data: KlineChartItem[];
  btcData: KlineChartItem[];
}

export interface StrategyHookAfterDecisionContext
  extends StrategyHookBaseContext {
  decision: StrategyDecision;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}

export interface StrategyHookSkipContext
  extends StrategyHookAfterDecisionContext {
  decision: Extract<StrategyDecision, { kind: 'skip' }>;
}

export interface StrategyHookBeforeCloseContext
  extends StrategyHookBaseContext {
  decision: Extract<StrategyDecision, { kind: 'exit' }>;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}

export interface StrategyHookEnrichContext extends StrategyHookBaseContext {
  decision: Extract<StrategyDecision, { kind: 'entry' }>;
  resolvedRuntime: StrategyEntryRuntimeOptions;
  signal: Signal;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}

export interface StrategyHookAfterAiContext extends StrategyHookEnrichContext {
  quality?: number;
}

export interface StrategyHookPolicyContext {
  quality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}

export interface StrategyHookBeforeEntryGateContext
  extends StrategyHookBaseContext {
  decision: Extract<StrategyDecision, { kind: 'entry' }>;
  resolvedRuntime: StrategyEntryRuntimeOptions;
  signal?: Signal;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
  policyContext: StrategyHookPolicyContext;
}

export interface StrategyHookBeforePlaceOrderContext
  extends StrategyHookBaseContext {
  decision: Extract<StrategyDecision, { kind: 'entry' }>;
  resolvedRuntime: StrategyEntryRuntimeOptions;
  signal?: Signal;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
}

export interface StrategyHookAfterPlaceOrderContext
  extends StrategyHookBaseContext {
  decision: Extract<StrategyDecision, { kind: 'entry' }>;
  resolvedRuntime: StrategyEntryRuntimeOptions;
  signal?: Signal;
  candle: KlineChartItem;
  btcCandle: KlineChartItem;
  orderResult: Signal | string;
}

export interface StrategyManifest {
  name: string;
  entryRuntimeDefaults?: {
    ai?: StrategyRuntimeAiOptions;
    ml?: Pick<StrategyRuntimeMlOptions, 'enabled'>;
  };
  hooks?: {
    onInit?: (params: StrategyHookInitContext) => Promise<void> | void;
    afterCoreDecision?: (
      params: StrategyHookAfterDecisionContext,
    ) => Promise<void> | void;
    onSkip?: (params: StrategyHookSkipContext) => Promise<void> | void;
    beforeClosePosition?: (
      params: StrategyHookBeforeCloseContext,
    ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
    afterEnrichMl?: (params: StrategyHookEnrichContext) => Promise<void> | void;
    afterEnrichAi?: (
      params: StrategyHookAfterAiContext,
    ) => Promise<void> | void;
    beforeEntryGate?: (
      params: StrategyHookBeforeEntryGateContext,
    ) => Promise<StrategyHookGateResult | void> | StrategyHookGateResult | void;
    beforePlaceOrder?: (
      params: StrategyHookBeforePlaceOrderContext,
    ) => Promise<void> | void;
    afterPlaceOrder?: (
      params: StrategyHookAfterPlaceOrderContext,
    ) => Promise<void> | void;
    onRuntimeError?: (params: StrategyHookErrorContext) => Promise<void> | void;
  };
  aiAdapter?: StrategyAiAdapter;
  mlAdapter?: StrategyMlAdapter;
}
