import {
  BuildEntryOrderPlanParams,
  BuildMlRuntimeOptionsParams,
  BuildStrategySignalDraft,
  BuildStrategySignalParams,
  Signal,
} from '@types';
import type {
  StrategyDecision,
  StrategyEntryOrderPlan,
  StrategyEntryRuntimeOptions,
} from '@utils/strategyRuntime';
import type { StrategyRuntimeMlOptions } from '@utils/strategyRuntime';
import { uuid } from '@utils/uuid';

export const buildStrategySignal = ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  prices,
  figures = {},
  indicators = {},
  additionalIndicators,
  configFromBacktest,
}: BuildStrategySignalParams): Signal => ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  figures,
  prices,
  indicators,
  additionalIndicators,
  configFromBacktest,
});

interface BuildEntrySignalDecisionParams {
  code: string;
  signal: BuildStrategySignalDraft;
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

interface BuildEntryRuntimePolicyParams {
  ml?: StrategyEntryRuntimeOptions['ml'];
  aiEnabled?: StrategyEntryRuntimeOptions['aiEnabled'];
  minAiQuality?: StrategyEntryRuntimeOptions['minAiQuality'];
  beforePlaceOrder?: StrategyEntryRuntimeOptions['beforePlaceOrder'];
}

export const buildMlRuntimeOptions = ({
  strategyName,
  strategyConfig,
  symbol,
  mlThreshold,
}: BuildMlRuntimeOptionsParams): StrategyRuntimeMlOptions => ({
  strategyName,
  strategyConfig,
  symbol,
  mlThreshold,
});

export const buildEntryRuntimePolicy = ({
  ml,
  aiEnabled,
  minAiQuality,
  beforePlaceOrder,
}: BuildEntryRuntimePolicyParams): StrategyEntryRuntimeOptions => ({
  ml,
  aiEnabled,
  minAiQuality,
  beforePlaceOrder,
});

export const buildEntryOrderPlan = ({
  qty,
  price,
  timestamp,
  direction,
  takeProfits,
  stopLossPrice,
}: BuildEntryOrderPlanParams): StrategyEntryOrderPlan => ({
  qty,
  price,
  timestamp,
  direction,
  takeProfits,
  stopLossPrice,
});

export const buildEntrySignalDecision = ({
  code,
  signal,
  orderPlan,
  runtime,
}: BuildEntrySignalDecisionParams): StrategyDecision => ({
  kind: 'entry',
  code,
  signal: buildStrategySignal({
    signalId: signal.signalId ?? uuid(),
    ...signal,
  }),
  orderPlan,
  runtime,
});
