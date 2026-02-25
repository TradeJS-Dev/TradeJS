import { AiPayload, Signal, StrategyAiAdapter } from '@types';
import { trimSeriesDeep } from '@utils/aiShared';
import { getStrategyManifest } from '../../strategy/manifests';

const buildBaseAiPayload = (signal: Signal): AiPayload => ({
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
  indicators: trimSeriesDeep(signal.indicators),
  additionalIndicators: trimSeriesDeep(signal.additionalIndicators ?? {}),
});

const defaultAiAdapter: StrategyAiAdapter = {};

export const getStrategyAiAdapter = (strategy?: string): StrategyAiAdapter =>
  getStrategyManifest(strategy)?.aiAdapter ?? defaultAiAdapter;

export const buildAiPayloadByStrategy = (signal: Signal): AiPayload => {
  const basePayload = buildBaseAiPayload(signal);
  const adapter = getStrategyAiAdapter(signal.strategy);
  return adapter.buildPayload?.({ signal, basePayload }) ?? basePayload;
};

export const buildAiSystemPromptAddonByStrategy = (signal: Signal): string =>
  getStrategyAiAdapter(signal.strategy).buildSystemPromptAddon?.({ signal }) ?? '';

export const buildAiHumanPromptAddonByStrategy = (
  signal: Signal,
  payload: AiPayload,
): string =>
  getStrategyAiAdapter(signal.strategy).buildHumanPromptAddon?.({
    signal,
    payload,
  }) ?? '';
