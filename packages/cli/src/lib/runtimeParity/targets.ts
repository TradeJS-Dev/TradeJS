import type {
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
} from '@tradejs/types';
import {
  loadRuntimeStrategyNames,
  loadStrategyResultSymbols,
} from '../runtimeRedis';

export type ReplayTarget = {
  strategy: string;
  symbol: string;
  sources: Array<
    'runtime' | 'strategyResults' | 'connectorUniverse' | 'explicitTickers'
  >;
};

export type ReplayInputsIndex = Map<
  string,
  {
    runtimeTrades: RuntimeTradeRecord[];
    runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  }
>;

export type ReplayError = ReplayTarget & {
  message: string;
};

export type ReplayTargetSourceCounts = {
  runtime: number;
  connectorUniverse: number;
  explicitTickers: number;
  strategyResults: number;
};

export const parseSymbolsFromCLI = (symbols = '') =>
  symbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .map((symbol) => (symbol.endsWith('USDT') ? symbol : `${symbol}USDT`));

export const toTargetKey = (
  target: Pick<ReplayTarget, 'strategy' | 'symbol'>,
) => `${target.strategy}::${target.symbol}`;

export const buildReplayInputsIndex = ({
  runtimeTrades,
  runtimeSignalEvaluations,
}: {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
}): ReplayInputsIndex => {
  const index: ReplayInputsIndex = new Map();

  for (const trade of runtimeTrades) {
    const key = toTargetKey(trade);
    const bucket = index.get(key) ?? {
      runtimeTrades: [],
      runtimeSignalEvaluations: [],
    };
    bucket.runtimeTrades.push(trade);
    index.set(key, bucket);
  }

  for (const evaluation of runtimeSignalEvaluations) {
    const key = toTargetKey(evaluation);
    const bucket = index.get(key) ?? {
      runtimeTrades: [],
      runtimeSignalEvaluations: [],
    };
    bucket.runtimeSignalEvaluations.push(evaluation);
    index.set(key, bucket);
  }

  return index;
};

const addReplayTarget = (
  targets: Map<string, ReplayTarget>,
  target: Pick<ReplayTarget, 'strategy' | 'symbol'>,
  source: ReplayTarget['sources'][number],
) => {
  const key = toTargetKey(target);
  const existing = targets.get(key);

  if (existing) {
    if (!existing.sources.includes(source)) {
      existing.sources.push(source);
    }
    return;
  }

  targets.set(key, {
    strategy: target.strategy,
    symbol: target.symbol,
    sources: [source],
  });
};

export const countReplayTargetSources = (
  targets: ReplayTarget[],
): ReplayTargetSourceCounts => ({
  runtime: targets.filter((target) => target.sources.includes('runtime'))
    .length,
  connectorUniverse: targets.filter((target) =>
    target.sources.includes('connectorUniverse'),
  ).length,
  explicitTickers: targets.filter((target) =>
    target.sources.includes('explicitTickers'),
  ).length,
  strategyResults: targets.filter((target) =>
    target.sources.includes('strategyResults'),
  ).length,
});

export const buildReplayTargets = async ({
  userName,
  runtimeTrades,
  connectorSymbols,
  strategyFilter,
  explicitSymbols,
  includeConnectorUniverse,
}: {
  userName: string;
  runtimeTrades: RuntimeTradeRecord[];
  connectorSymbols: string[];
  strategyFilter?: string;
  explicitSymbols: string[];
  includeConnectorUniverse: boolean;
}) => {
  const targets = new Map<string, ReplayTarget>();
  let configuredStrategies = (await loadRuntimeStrategyNames(userName)).filter(
    (strategy) => !strategyFilter || strategy === strategyFilter,
  );
  if (
    strategyFilter &&
    !configuredStrategies.some((strategy) => strategy === strategyFilter)
  ) {
    configuredStrategies = [strategyFilter];
  }
  const explicitSymbolSet = explicitSymbols.length
    ? new Set(explicitSymbols)
    : null;

  for (const trade of runtimeTrades) {
    if (strategyFilter && trade.strategy !== strategyFilter) {
      continue;
    }
    if (explicitSymbolSet && !explicitSymbolSet.has(trade.symbol)) {
      continue;
    }
    addReplayTarget(
      targets,
      { strategy: trade.strategy, symbol: trade.symbol },
      'runtime',
    );
  }

  if (explicitSymbols.length || includeConnectorUniverse) {
    const universeSymbols = explicitSymbols.length
      ? explicitSymbols
      : connectorSymbols;
    const universeSource = explicitSymbols.length
      ? 'explicitTickers'
      : 'connectorUniverse';

    for (const strategy of configuredStrategies) {
      for (const symbol of universeSymbols) {
        addReplayTarget(targets, { strategy, symbol }, universeSource);
      }
    }
  }

  const strategySymbolsEntries = await Promise.all(
    configuredStrategies.map(
      async (strategy) =>
        [
          strategy,
          await loadStrategyResultSymbols({ userName, strategy }),
        ] as const,
    ),
  );

  for (const [strategy, symbols] of strategySymbolsEntries) {
    for (const symbol of symbols) {
      if (explicitSymbolSet && !explicitSymbolSet.has(symbol)) {
        continue;
      }
      addReplayTarget(targets, { strategy, symbol }, 'strategyResults');
    }
  }

  return [...targets.values()].sort(
    (left, right) =>
      left.strategy.localeCompare(right.strategy) ||
      left.symbol.localeCompare(right.symbol),
  );
};
