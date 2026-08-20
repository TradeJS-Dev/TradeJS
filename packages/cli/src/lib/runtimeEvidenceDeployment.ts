import type {
  AssetClass,
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategySelection,
  RuntimeStrategyControlState,
  StrategyConfig,
} from '@tradejs/types';
import {
  getRuntimeDeployment,
  loadResolvedRuntimeStrategies,
} from '@tradejs/node/runtimeStrategies';

export type RuntimeEvidenceStrategySnapshot = {
  strategyName: string;
  version: number;
  enabled: boolean;
  controlState: RuntimeStrategyControlState;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  strategyPackage: string;
  strategyPackageVersion: string;
  runtimePackageVersion: string;
  strategyConfig: StrategyConfig;
  selection?: RuntimeStrategySelection;
};

export type RuntimeEvidenceDeploymentSnapshot = {
  schemaVersion: 1;
  id: string;
  label: string;
  connectorName: string;
  provider: string;
  accountId: string;
  enabled: boolean;
  assetClasses?: AssetClass[];
  tickers?: string[];
  strategies: RuntimeEvidenceStrategySnapshot[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const INTERVALS = new Set([
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '240',
  '360',
  '720',
  'D',
  'W',
  'M',
]);

const UNIVERSES = new Set(['crypto', 'tradfi']);

const isRuntimeStrategySelection = (
  value: unknown,
): value is RuntimeStrategySelection =>
  value === undefined ||
  (isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.keys(value).every((key) => key === 'tickers') &&
    Array.isArray(value.tickers) &&
    value.tickers.length > 0 &&
    value.tickers.every((ticker) => isNonEmptyString(ticker)));

export const parseRuntimeEvidenceDeploymentSnapshot = (
  value: unknown,
): RuntimeEvidenceDeploymentSnapshot => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isNonEmptyString(value.connectorName) ||
    !isNonEmptyString(value.provider) ||
    !isNonEmptyString(value.accountId) ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.strategies)
  ) {
    throw new Error(
      'Runtime evidence deployment snapshot is missing or invalid',
    );
  }

  const strategies = value.strategies.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.strategyName) ||
      !Number.isSafeInteger(candidate.version) ||
      Number(candidate.version) <= 0 ||
      typeof candidate.enabled !== 'boolean' ||
      !['active', 'entries_paused'].includes(String(candidate.controlState)) ||
      !INTERVALS.has(String(candidate.interval)) ||
      !UNIVERSES.has(String(candidate.universe)) ||
      !isNonEmptyString(candidate.strategyPackage) ||
      !isNonEmptyString(candidate.strategyPackageVersion) ||
      !isNonEmptyString(candidate.runtimePackageVersion) ||
      !isRecord(candidate.strategyConfig) ||
      !isRuntimeStrategySelection(candidate.selection)
    ) {
      throw new Error(
        'Runtime evidence deployment strategy snapshot is invalid',
      );
    }
    if (
      String(candidate.strategyConfig.INTERVAL) !==
        String(candidate.interval) ||
      String(candidate.strategyConfig.UNIVERSE) !== String(candidate.universe)
    ) {
      throw new Error(
        `Runtime evidence strategy config does not match its scope: ${candidate.strategyName}`,
      );
    }
    if (
      candidate.accountId != null &&
      (!isNonEmptyString(candidate.accountId) ||
        candidate.accountId !== value.accountId)
    ) {
      throw new Error(
        `Runtime evidence strategy account does not match deployment: ${candidate.strategyName}`,
      );
    }
    return candidate as unknown as RuntimeEvidenceStrategySnapshot;
  });

  const identities = new Set<string>();
  for (const strategy of strategies) {
    if (identities.has(strategy.strategyName)) {
      throw new Error(
        `Duplicate runtime evidence strategy: ${strategy.strategyName}`,
      );
    }
    identities.add(strategy.strategyName);
  }

  return {
    ...(value as unknown as RuntimeEvidenceDeploymentSnapshot),
    strategies,
  };
};

export const activeRuntimeEvidenceStrategies = (
  deployment: RuntimeEvidenceDeploymentSnapshot,
) =>
  deployment.enabled
    ? deployment.strategies.filter((strategy) => strategy.enabled)
    : [];

export const runtimeDeploymentFromEvidence = (
  deployment: RuntimeEvidenceDeploymentSnapshot,
): RuntimeDeployment => ({
  id: deployment.id,
  label: deployment.label,
  connectorName: deployment.connectorName,
  provider: deployment.provider,
  accountId: deployment.accountId,
  enabled: deployment.enabled,
  strategies: deployment.strategies.map(
    ({ strategyName, version, enabled, controlState, selection }) => ({
      strategyName,
      version,
      enabled,
      controlState,
      ...(selection ? { selection } : {}),
    }),
  ),
  ...(deployment.assetClasses
    ? { assetClasses: [...deployment.assetClasses] }
    : {}),
  ...(deployment.tickers ? { tickers: [...deployment.tickers] } : {}),
});

export const resolveRuntimeEvidenceDeploymentSnapshot = async ({
  userName,
  projectRoot,
  deploymentId,
}: {
  userName: string;
  projectRoot: string;
  deploymentId: string;
}): Promise<RuntimeEvidenceDeploymentSnapshot> => {
  const [deployment, strategies] = await Promise.all([
    getRuntimeDeployment({ userName, projectRoot, deploymentId }),
    loadResolvedRuntimeStrategies({ userName, projectRoot, deploymentId }),
  ]);
  if (!deployment) {
    throw new Error(`Runtime deployment not found: ${deploymentId}`);
  }

  return {
    schemaVersion: 1,
    id: deployment.id,
    label: deployment.label,
    connectorName: deployment.connectorName,
    provider: deployment.provider,
    accountId: deployment.accountId,
    enabled: deployment.enabled,
    strategies: strategies.map(
      ({
        strategyName,
        version,
        enabled,
        controlState,
        interval,
        universe,
        accountId,
        strategyPackage,
        strategyPackageVersion,
        runtimePackageVersion,
        sourceStrategyConfig,
        selection,
      }) => ({
        strategyName,
        version,
        enabled,
        controlState,
        interval,
        universe,
        ...(accountId ? { accountId } : {}),
        strategyPackage,
        strategyPackageVersion,
        runtimePackageVersion,
        strategyConfig: sourceStrategyConfig,
        ...(selection ? { selection } : {}),
      }),
    ),
    ...(deployment.assetClasses
      ? { assetClasses: [...deployment.assetClasses] }
      : {}),
    ...(deployment.tickers ? { tickers: [...deployment.tickers] } : {}),
  };
};
