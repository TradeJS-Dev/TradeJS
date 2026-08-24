import type { TradejsConfigHooks } from '@tradejs/core/config';
import type {
  Connector,
  StrategyConfig,
  StrategyDecision,
  StrategyHookCtx,
  StrategyHookStage,
} from '@tradejs/types';

export const normalizeConfigHookList = <
  THook extends (...args: any[]) => unknown,
>(
  value: THook | THook[] | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
};

export const isStrategyDecision = (
  value: unknown,
): value is StrategyDecision => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === 'skip' || kind === 'entry' || kind === 'exit' || kind === 'protect'
  );
};

const CONFIG_HOOK_STAGES: Array<StrategyHookStage & keyof TradejsConfigHooks> =
  [
    'onInit',
    'onBar',
    'afterCoreDecision',
    'afterBarDecision',
    'onSkip',
    'beforeClosePosition',
    'afterEnrichMl',
    'afterEnrichAi',
    'beforeEntryGate',
    'beforePlaceOrder',
    'afterPlaceOrder',
  ];

export const isConfigHookStage = (
  stage: StrategyHookStage,
): stage is StrategyHookStage & keyof TradejsConfigHooks =>
  CONFIG_HOOK_STAGES.includes(
    stage as StrategyHookStage & keyof TradejsConfigHooks,
  );

export const buildHookCtx = ({
  connector,
  strategyName,
  userName,
  symbol,
  universe,
  assetClass,
  accountId,
  deploymentId,
  policyProfileId,
  strategyConfig,
  env,
  isConfigFromBacktest,
}: {
  connector: Connector;
  strategyName: string;
  userName: string;
  symbol: string;
  universe?: StrategyHookCtx['universe'];
  assetClass?: StrategyHookCtx['assetClass'];
  accountId?: string;
  deploymentId?: string;
  policyProfileId?: string;
  strategyConfig: StrategyConfig;
  env: string;
  isConfigFromBacktest: boolean;
}): StrategyHookCtx => ({
  connector,
  strategyName,
  userName,
  symbol,
  ...(universe ? { universe } : {}),
  ...(assetClass ? { assetClass } : {}),
  ...(accountId ? { accountId } : {}),
  ...(deploymentId ? { deploymentId } : {}),
  ...(policyProfileId ? { policyProfileId } : {}),
  strategyConfig,
  env,
  isConfigFromBacktest,
});

export const shouldRecordRuntimeJournal = ({
  env,
  config,
}: {
  env: string;
  config: StrategyConfig;
}) =>
  env !== 'BACKTEST' &&
  env !== 'PARITY' &&
  config.RECORD_RUNTIME_TRADES !== false;

export const isTestConnector = (connector: Connector) =>
  Boolean(
    (connector as unknown as { __tradejsTestConnector?: unknown })
      .__tradejsTestConnector,
  );

export const isRuntimeOrderExecutionEnabled = ({
  config,
  env,
  connector,
  externalOrderPlacement = process.env.TRADEJS_EXTERNAL_ORDER_PLACEMENT,
}: {
  config: StrategyConfig;
  env: string;
  connector: Connector;
  externalOrderPlacement?: string;
}) => {
  const testConnector = isTestConnector(connector);
  const simulationEnabled =
    env === 'PARITY' && config.SIMULATE_ORDERS === true && testConnector;
  const makeOrdersRequested =
    typeof config.MAKE_ORDERS === 'boolean' ? config.MAKE_ORDERS : true;

  if (!testConnector && externalOrderPlacement === 'false') return false;
  if (env === 'PARITY' && !testConnector) return false;
  return makeOrdersRequested || simulationEnabled;
};

export const canUseSharedReplayState = ({
  env,
  sharedReplayKey,
}: {
  env: string;
  sharedReplayKey?: string;
}) => (env === 'BACKTEST' || env === 'PARITY') && Boolean(sharedReplayKey);
