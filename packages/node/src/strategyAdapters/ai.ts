import {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';
import { buildCompactAiIndicatorsSnapshot, trimSeriesDeep } from '../aiShared';
import { buildAiMarketContext } from '../aiMarketContext';
import { getStrategyManifest } from '../strategy/manifests';

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const buildBaseAiPayload = (signal: Signal): AiPayload => {
  const additionalIndicators = {
    ...toRecord(signal.additionalIndicators),
    marketContext: buildAiMarketContext(signal),
  };

  return {
    signal: {
      symbol: signal.symbol,
      signalId: signal.signalId,
      interval: signal.interval,
      direction: signal.direction,
      timestamp: signal.timestamp,
      strategy: signal.strategy,
      prices: {
        currentPrice: signal.prices.currentPrice,
        takeProfitPrice: signal.prices.takeProfitPrice,
        stopLossPrice: signal.prices.stopLossPrice,
      },
    },
    figures: trimSeriesDeep(signal.figures ?? {}),
    indicators: buildCompactAiIndicatorsSnapshot(signal.indicators),
    additionalIndicators: trimSeriesDeep(additionalIndicators),
  };
};

const defaultAiAdapter: StrategyAiAdapter = {};

export const getStrategyAiAdapter = (strategy?: string): StrategyAiAdapter =>
  getStrategyManifest(strategy)?.aiAdapter ?? defaultAiAdapter;

const getSignalAiAdapter = (signal: Signal) =>
  getStrategyAiAdapter(signal.strategy);

export const buildAiPayloadByStrategy = (signal: Signal): AiPayload => {
  const basePayload = buildBaseAiPayload(signal);
  const adapter = getSignalAiAdapter(signal);
  return adapter.buildPayload?.({ signal, basePayload }) ?? basePayload;
};

export const buildAiSystemPromptAddonByStrategy = (signal: Signal): string =>
  getSignalAiAdapter(signal).buildSystemPromptAddon?.({ signal }) ?? '';

export const buildAiHumanPromptAddonByStrategy = (
  signal: Signal,
  payload: AiPayload,
): string =>
  getSignalAiAdapter(signal).buildHumanPromptAddon?.({
    signal,
    payload,
  }) ?? '';

export const postProcessAiAnalysisByStrategy = (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
  payload = buildAiPayloadByStrategy(signal),
): Partial<SignalAnalysis> =>
  getSignalAiAdapter(signal).postProcessAnalysis?.({
    signal,
    payload,
    analysis,
  }) ?? analysis;
