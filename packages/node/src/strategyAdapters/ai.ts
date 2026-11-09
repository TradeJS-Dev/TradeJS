import { getRegisteredIndicatorEntries } from '@tradejs/core/indicators';
import { getTradejsProjectCwd } from '../tradejsConfig';
import {
  projectAiFeatures,
  TICKER_PROFILE_AI_FEATURES,
  validateAiFeatureDefinitions,
  validateAiFeatureSnapshot,
} from '@tradejs/core/aiFeatures';
import {
  AiPayload,
  Signal,
  SignalAnalysis,
  StrategyAiAdapter,
} from '@tradejs/types';
import { buildCompactAiIndicatorsSnapshot, trimSeriesDeep } from '../aiShared';
import { buildAiMarketContext } from '../aiMarketContext';
import { getStrategyManifest } from '../strategy/manifests';
import { getStrategyProfileAiAdapter } from '../strategy/policyProfiles';

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const buildBaseAiPayload = (signal: Signal): AiPayload => {
  const { jevEvidence: _jevEvidence, ...signalAdditionalIndicators } = toRecord(
    signal.additionalIndicators,
  );
  const additionalIndicators = {
    ...signalAdditionalIndicators,
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
const tickerProfileFeatureIds = new Set(
  TICKER_PROFILE_AI_FEATURES.map(({ id }) => id),
);

export const getStrategyAiAdapter = (
  strategy?: string,
  profileId?: string,
): StrategyAiAdapter =>
  getStrategyProfileAiAdapter(getStrategyManifest(strategy), profileId) ??
  defaultAiAdapter;

const getSignalAiAdapter = (signal: Signal) =>
  getStrategyAiAdapter(signal.strategy, signal.policyProfileId);

export const buildAiPayloadByStrategy = (signal: Signal): AiPayload => {
  const basePayload = buildBaseAiPayload(signal);
  const adapter = getSignalAiAdapter(signal);
  const payload =
    adapter.buildPayload?.({ signal, basePayload }) ?? basePayload;
  const custom = getStrategyManifest(signal.strategy)?.aiFeatures ?? [];
  const frozen = signal.aiFeatureReplay?.snapshot;
  if (frozen) validateAiFeatureSnapshot(frozen);
  const tickerProfile =
    signal.additionalIndicators?.tickerProfile ??
    signal.additionalIndicators?.baseContext?.tickerProfile;
  const hasProfile = Boolean(
    tickerProfile ||
      frozen?.definitions.some(({ id }) => tickerProfileFeatureIds.has(id)),
  );
  const indicatorFeatures = getRegisteredIndicatorEntries(
    getTradejsProjectCwd(),
  ).flatMap((entry) => (entry.indicator.enabled ? entry.aiFeatures ?? [] : []));
  const definitions = [
    ...(hasProfile ? TICKER_PROFILE_AI_FEATURES : []),
    ...indicatorFeatures,
    ...custom,
  ];
  if (!definitions.length && !signal.aiFeatureReplay?.snapshot) return payload;
  validateAiFeatureDefinitions(definitions);
  if (signal.aiFeatureReplay && !frozen) {
    throw new Error(
      'Dataset has no frozen AI features; regenerate the decision-time export',
    );
  }
  if (
    frozen &&
    JSON.stringify(frozen.definitions) !== JSON.stringify(definitions)
  ) {
    throw new Error(
      'AI feature definition changed; regenerate the decision-time export',
    );
  }
  return {
    ...payload,
    featureSnapshot:
      frozen ??
      projectAiFeatures(definitions, {
        signal: tickerProfile
          ? {
              ...signal,
              additionalIndicators: {
                ...signal.additionalIndicators,
                tickerProfile,
              },
            }
          : signal,
        payload,
      }),
  };
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

export const postProcessLocalAiAnalysisByStrategy = (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
  payload = buildAiPayloadByStrategy(signal),
): Partial<SignalAnalysis> => {
  const adapter = getSignalAiAdapter(signal);
  const strategyAnalysis =
    adapter.postProcessAnalysis?.({ signal, payload, analysis }) ?? analysis;

  return (
    adapter.postProcessLocalAnalysis?.({
      signal,
      payload,
      analysis: strategyAnalysis,
    }) ?? strategyAnalysis
  );
};
