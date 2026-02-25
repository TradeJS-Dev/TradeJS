import {
  StrategyEntryRuntimeOptions,
  StrategyEntrySignalContext,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
} from './strategy';
import { StrategyConfig } from './backtest';
import { Connector, Signal } from './trade';

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
  buildPayload?: (params: { signal: Signal; basePayload: AiPayload }) => AiPayload;
  buildSystemPromptAddon?: (params: { signal: Signal }) => string;
  buildHumanPromptAddon?: (params: { signal: Signal; payload: AiPayload }) => string;
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

export interface StrategyManifest {
  name: string;
  entryRuntimeDefaults?: {
    ai?: StrategyRuntimeAiOptions;
    ml?: Pick<StrategyRuntimeMlOptions, 'enabled'>;
  };
  hooks?: {
    beforePlaceOrder?: (params: {
      connector: Connector;
      entryContext: StrategyEntrySignalContext;
      config: StrategyConfig;
      runtime: StrategyEntryRuntimeOptions | undefined;
    }) => Promise<void>;
  };
  aiAdapter?: StrategyAiAdapter;
  mlAdapter?: StrategyMlAdapter;
}
