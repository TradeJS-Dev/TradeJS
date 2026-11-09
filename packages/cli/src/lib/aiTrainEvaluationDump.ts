import type { AiFeatureSnapshot } from '@tradejs/types';
import type { AiTrainDumpFeatureMode } from './aiTrainOptions';

type JsonRecord = Record<string, unknown>;

export type AiTrainEvaluationFeatureSnapshot =
  | {
      baseContextAvailable: false;
      featureSnapshot?: AiFeatureSnapshot;
    }
  | {
      baseContextAvailable: true;
      featureSnapshot?: AiFeatureSnapshot;
      gateFeatures?: unknown;
      strategyGateFeatures?: JsonRecord;
      baseContext?: JsonRecord;
    };

const BASE_CONTEXT_FEATURE_SECTIONS = [
  'regime',
  'structure',
  'participation',
  'relative',
  'derivatives',
  'mtf',
  'gateFeatures',
  'tickerProfile',
] as const;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === 'object' && value != null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const collectStrategyGateFeatures = (
  baseContext: JsonRecord,
): JsonRecord | undefined => {
  const entries = Object.entries(baseContext).filter(
    ([key, value]) =>
      key !== 'gateFeatures' &&
      key.endsWith('GateFeatures') &&
      asRecord(value) != null,
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const pickBaseContextFeatureSections = (baseContext: JsonRecord) =>
  Object.fromEntries(
    BASE_CONTEXT_FEATURE_SECTIONS.map((section) => [
      section,
      baseContext[section] ?? null,
    ]),
  );

export const buildAiTrainEvaluationFeatureSnapshot = ({
  additionalIndicators,
  featureSnapshot,
  mode,
}: {
  additionalIndicators: unknown;
  featureSnapshot?: AiFeatureSnapshot;
  mode: AiTrainDumpFeatureMode;
}): AiTrainEvaluationFeatureSnapshot | undefined => {
  if (mode === 'none') {
    return undefined;
  }

  const additional = asRecord(additionalIndicators);
  const baseContext = asRecord(additional?.baseContext);
  if (!baseContext) {
    return {
      baseContextAvailable: false,
      ...(featureSnapshot ? { featureSnapshot } : {}),
    };
  }

  const strategyGateFeatures = collectStrategyGateFeatures(baseContext);
  const snapshot: AiTrainEvaluationFeatureSnapshot = {
    baseContextAvailable: true,
    ...(featureSnapshot ? { featureSnapshot } : {}),
    gateFeatures: baseContext.gateFeatures ?? null,
    ...(strategyGateFeatures ? { strategyGateFeatures } : {}),
  };

  if (mode === 'baseContext') {
    snapshot.baseContext = pickBaseContextFeatureSections(baseContext);
  }

  return snapshot;
};
