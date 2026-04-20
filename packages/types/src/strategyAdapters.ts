import {
  StrategyDecision,
  StrategyEntryOrderPlan,
  StrategyEntrySignalContext,
  StrategyEntryRuntimeOptions,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
} from './strategy';
import { StrategyConfig } from './backtest';
import { Connector, KlineChartItem, Signal, SignalAnalysis } from './trade';

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
  postProcessAnalysis?: (params: {
    signal: Signal;
    payload: AiPayload;
    analysis: Partial<SignalAnalysis>;
  }) => Partial<SignalAnalysis>;
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

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;
type ExitDecision = Extract<StrategyDecision, { kind: 'exit' }>;

export interface StrategyHookCtx {
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}

export interface StrategyHookMarketContext {
  candle?: KlineChartItem;
  btcCandle?: KlineChartItem;
  data?: KlineChartItem[];
  btcData?: KlineChartItem[];
}

export interface StrategyHookEntryContext {
  context: StrategyEntrySignalContext;
  orderPlan: StrategyEntryOrderPlan;
  signal?: Signal;
  runtime: {
    raw?: StrategyEntryRuntimeOptions;
    resolved: StrategyEntryRuntimeOptions;
  };
}

export type StrategyHookMlSkippedReason =
  | 'BACKTEST'
  | 'DISABLED'
  | 'NO_RUNTIME'
  | 'NO_STRATEGY_CONFIG'
  | 'NO_THRESHOLD'
  | 'NO_RESULT';

export interface StrategyHookMlContext {
  config?: StrategyRuntimeMlOptions;
  attempted: boolean;
  applied: boolean;
  result?: Signal['ml'];
  skippedReason?: StrategyHookMlSkippedReason;
}

export type StrategyHookAiSkippedReason =
  | 'BACKTEST'
  | 'DISABLED'
  | 'NO_RUNTIME'
  | 'NO_QUALITY';

export interface StrategyHookAiContext {
  config?: StrategyRuntimeAiOptions;
  attempted: boolean;
  applied: boolean;
  quality?: number;
  skippedReason?: StrategyHookAiSkippedReason;
}

export type StrategyHookStage =
  | 'onInit'
  | 'onBar'
  | 'afterCoreDecision'
  | 'afterBarDecision'
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
  | 'setTakeProfits'
  | 'setStopLoss'
  | 'protectPosition'
  | 'closePosition'
  | 'placeOrder';

export interface StrategyHookErrorPayload {
  stage: StrategyHookStage;
  cause: unknown;
}

export interface StrategyHookErrorContext {
  ctx: StrategyHookCtx;
  market?: StrategyHookMarketContext;
  decision?: StrategyDecision;
  entry?: StrategyHookEntryContext;
  error: StrategyHookErrorPayload;
}

export interface StrategyHookInitContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'data' | 'btcData'>>;
}

export interface StrategyHookBarContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>>;
}

export interface StrategyHookAfterDecisionContext
  extends StrategyHookBarContext {
  decision: StrategyDecision;
}

export interface StrategyHookSkipContext
  extends StrategyHookAfterDecisionContext {
  decision: Extract<StrategyDecision, { kind: 'skip' }>;
}

export interface StrategyHookBeforeCloseContext
  extends StrategyHookAfterDecisionContext {
  decision: ExitDecision;
}

export interface StrategyHookEnrichContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>>;
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  ml: StrategyHookMlContext;
}

export interface StrategyHookAfterAiContext extends StrategyHookEnrichContext {
  ai: StrategyHookAiContext;
}

export interface StrategyHookPolicyContext {
  aiQuality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}

export interface StrategyHookBeforeEntryGateContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>>;
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
}

export interface StrategyHookBeforePlaceOrderContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>>;
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
}

export interface StrategyHookOrderContext {
  result: Signal | string;
}

export interface StrategyHookAfterPlaceOrderContext {
  ctx: StrategyHookCtx;
  market: Required<Pick<StrategyHookMarketContext, 'candle' | 'btcCandle'>>;
  decision: EntryDecision;
  entry: StrategyHookEntryContext;
  policy: StrategyHookPolicyContext;
  ml?: StrategyHookMlContext;
  ai?: StrategyHookAiContext;
  order: StrategyHookOrderContext;
}

export interface StrategyManifest {
  name: string;
  entryRuntimeDefaults?: {
    ai?: StrategyRuntimeAiOptions;
    ml?: Pick<StrategyRuntimeMlOptions, 'enabled'>;
  };
  hooks?: {
    onInit?: (params: StrategyHookInitContext) => Promise<void> | void;
    onBar?: (
      params: StrategyHookBarContext,
    ) => Promise<StrategyDecision | void> | StrategyDecision | void;
    afterCoreDecision?: (
      params: StrategyHookAfterDecisionContext,
    ) => Promise<void> | void;
    afterBarDecision?: (
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
