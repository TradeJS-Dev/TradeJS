import chalk from 'chalk';
import { ensureMarketContextSchemas } from '@tradejs/infra/timescale';
import {
  ensureStrategyPluginsLoaded,
  getStrategyManifest,
} from '@tradejs/node/registry';
import type {
  Interval,
  MarketUniverse,
  StrategyMarketContextSource,
} from '@tradejs/types';
import {
  backfillBinanceMarketContextForBacktest,
  backfillBinanceMarketContextForReplay,
  backfillBinanceMarketContextForSignals,
  shouldBackfillBinanceMarketContextForBacktest,
  shouldBackfillBinanceMarketContextForReplay,
  shouldBackfillBinanceMarketContextForSignals,
} from './binanceMarketContextBackfill';
import {
  backfillDerivativesContextForBacktest,
  backfillDerivativesContextForSignals,
  shouldBackfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForSignals,
} from './derivativesContextBackfill';
import {
  backfillCoinMarketCapContextForBacktest,
  backfillCoinMarketCapContextForReplay,
  backfillCoinMarketCapContextForSignals,
  shouldBackfillCoinMarketCapContextForBacktest,
  shouldBackfillCoinMarketCapContextForReplay,
  shouldBackfillCoinMarketCapContextForSignals,
} from './coinMarketCapContextBackfill';
import { timeOperation as runTimedOperation } from './runFormatting';
import { backfillHyperliquidWhaleContext } from './hyperliquidWhaleBackfill';

export type MarketContextRunMode = 'backtest' | 'signals' | 'replay' | 'parity';

export type PrepareMarketContextForRunParams = {
  mode: MarketContextRunMode;
  userName: string;
  projectRoot: string;
  symbols: string[];
  universe?: MarketUniverse;
  interval: Interval;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
  cacheOnly: boolean;
  aiEnabled?: boolean;
  mlEnabled?: boolean;
  strategyNames?: string[];
  log?: (message: string) => void;
};

export type MarketContextRequirementReason = 'ai' | 'core' | 'ml' | 'runtime';

export type MarketContextRunRequirements = Record<
  StrategyMarketContextSource,
  {
    read: boolean;
    backfill: boolean;
    requiredBy: MarketContextRequirementReason[];
  }
>;

const uniqueReasons = (reasons: MarketContextRequirementReason[]) => [
  ...new Set(reasons),
];

export const shouldPrepareDerivativesContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled' | 'universe'
  >,
) => {
  if (params.universe === 'tradfi') return false;
  if (params.mode === 'signals') {
    return shouldBackfillDerivativesContextForSignals({
      cacheOnly: params.cacheOnly,
    });
  }

  if (params.mode === 'backtest' && !params.aiEnabled && !params.mlEnabled) {
    return false;
  }

  return shouldBackfillDerivativesContextForBacktest({
    aiEnabled: Boolean(params.aiEnabled),
    cacheOnly: params.cacheOnly,
    mlEnabled: Boolean(params.mlEnabled),
  });
};

export const shouldPrepareBinanceMarketContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled' | 'universe'
  >,
) => {
  if (params.universe === 'tradfi') return false;
  if (params.mode === 'backtest') {
    if (!params.aiEnabled && !params.mlEnabled) return false;
    return shouldBackfillBinanceMarketContextForBacktest({
      aiEnabled: Boolean(params.aiEnabled),
      cacheOnly: params.cacheOnly,
      mlEnabled: Boolean(params.mlEnabled),
    });
  }

  if (params.mode === 'signals') {
    return shouldBackfillBinanceMarketContextForSignals({
      cacheOnly: params.cacheOnly,
    });
  }

  return shouldBackfillBinanceMarketContextForReplay({
    cacheOnly: params.cacheOnly,
  });
};

export const shouldPrepareCoinMarketCapContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled' | 'universe'
  >,
) => {
  if (params.universe === 'tradfi') return false;
  if (params.mode === 'backtest') {
    if (!params.aiEnabled && !params.mlEnabled) return false;
    return shouldBackfillCoinMarketCapContextForBacktest({
      aiEnabled: Boolean(params.aiEnabled),
      cacheOnly: params.cacheOnly,
      mlEnabled: Boolean(params.mlEnabled),
    });
  }

  if (params.mode === 'signals') {
    return shouldBackfillCoinMarketCapContextForSignals({
      cacheOnly: params.cacheOnly,
    });
  }

  return shouldBackfillCoinMarketCapContextForReplay({
    cacheOnly: params.cacheOnly,
  });
};

export const shouldPrepareHyperliquidWhaleContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    | 'mode'
    | 'cacheOnly'
    | 'aiEnabled'
    | 'mlEnabled'
    | 'universe'
    | 'strategyNames'
  >,
  coreContextSources: readonly StrategyMarketContextSource[] = [],
) => {
  const strategyRequiresContext =
    coreContextSources.includes('hyperliquidWhales');
  if (
    params.universe === 'tradfi' ||
    params.mode === 'signals' ||
    params.cacheOnly ||
    (!params.aiEnabled && !params.mlEnabled && !strategyRequiresContext)
  ) {
    return false;
  }
  const configured = String(
    process.env.HYPERLIQUID_WHALE_BACKFILL_ENABLED ?? '',
  )
    .trim()
    .toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(configured)) return false;
  if (strategyRequiresContext) return true;
  return ['1', 'true', 'yes', 'on'].includes(configured);
};

const resolveCoreContextSources = async (
  params: Pick<
    PrepareMarketContextForRunParams,
    'projectRoot' | 'strategyNames'
  >,
) => {
  const strategyNames = [...new Set(params.strategyNames ?? [])];
  if (!strategyNames.length) return [] as StrategyMarketContextSource[];
  await ensureStrategyPluginsLoaded(params.projectRoot);
  return [
    ...new Set(
      strategyNames.flatMap(
        (strategyName) =>
          getStrategyManifest(strategyName, params.projectRoot)
            ?.contextRequirements?.core ?? [],
      ),
    ),
  ];
};

export const resolveMarketContextRunRequirements = async (
  params: PrepareMarketContextForRunParams,
): Promise<MarketContextRunRequirements> => {
  const coreContextSources = await resolveCoreContextSources(params);
  const paramsWithCoreDemand = (source: StrategyMarketContextSource) =>
    coreContextSources.includes(source)
      ? { ...params, aiEnabled: true }
      : params;
  const isCrypto = params.universe !== 'tradfi';
  const capturesPayload = Boolean(params.aiEnabled || params.mlEnabled);
  const runtimeReadsContext = params.mode !== 'backtest';
  const reasonsFor = (
    source: StrategyMarketContextSource,
  ): MarketContextRequirementReason[] =>
    uniqueReasons([
      ...(coreContextSources.includes(source) ? (['core'] as const) : []),
      ...(params.aiEnabled ? (['ai'] as const) : []),
      ...(params.mlEnabled ? (['ml'] as const) : []),
      ...(runtimeReadsContext ? (['runtime'] as const) : []),
    ]);
  const readsStandardContext =
    isCrypto && (capturesPayload || runtimeReadsContext);
  const readsHyperliquid =
    isCrypto &&
    (readsStandardContext || coreContextSources.includes('hyperliquidWhales'));

  return {
    binance: {
      read: readsStandardContext || coreContextSources.includes('binance'),
      backfill: shouldPrepareBinanceMarketContextForRun(
        paramsWithCoreDemand('binance'),
      ),
      requiredBy: reasonsFor('binance'),
    },
    coinmarketcap: {
      read:
        readsStandardContext || coreContextSources.includes('coinmarketcap'),
      backfill: shouldPrepareCoinMarketCapContextForRun(
        paramsWithCoreDemand('coinmarketcap'),
      ),
      requiredBy: reasonsFor('coinmarketcap'),
    },
    derivatives: {
      read: readsStandardContext || coreContextSources.includes('derivatives'),
      backfill: shouldPrepareDerivativesContextForRun(
        paramsWithCoreDemand('derivatives'),
      ),
      requiredBy: reasonsFor('derivatives'),
    },
    hyperliquidWhales: {
      read: readsHyperliquid,
      backfill: shouldPrepareHyperliquidWhaleContextForRun(
        params,
        coreContextSources,
      ),
      requiredBy: reasonsFor('hyperliquidWhales'),
    },
  };
};

const resolveCoinMarketCapBackfillForMode = (mode: MarketContextRunMode) =>
  mode === 'backtest'
    ? backfillCoinMarketCapContextForBacktest
    : mode === 'signals'
      ? backfillCoinMarketCapContextForSignals
      : backfillCoinMarketCapContextForReplay;

const buildCoinMarketCapBackfillParams = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'userName' | 'startMs' | 'endMs' | 'preloadStartMs'
  >,
) => ({
  userName: params.userName,
  startMs: params.startMs,
  endMs: params.endMs,
  preloadStartMs: params.mode === 'signals' ? undefined : params.preloadStartMs,
});

const buildBinanceMarketBackfillParams = (
  params: Pick<
    PrepareMarketContextForRunParams,
    | 'userName'
    | 'mode'
    | 'projectRoot'
    | 'symbols'
    | 'interval'
    | 'startMs'
    | 'endMs'
    | 'preloadStartMs'
  >,
) => ({
  userName: params.userName,
  projectRoot: params.projectRoot,
  symbols: params.symbols,
  interval: params.interval,
  startMs: params.startMs,
  endMs: params.endMs,
  preloadStartMs: params.mode === 'signals' ? undefined : params.preloadStartMs,
});

const buildDerivativesBackfillParams = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'userName' | 'symbols' | 'startMs' | 'endMs' | 'preloadStartMs'
  >,
) => ({
  userName: params.userName,
  symbols: params.symbols,
  startMs: params.startMs,
  endMs: params.endMs,
  preloadStartMs: params.mode === 'signals' ? undefined : params.preloadStartMs,
});

export const prepareMarketContextForRun = async (
  params: PrepareMarketContextForRunParams,
) => {
  const log =
    params.log ??
    ((message: string) => {
      console.log(chalk.gray(message));
    });
  const timeOperation = <T>(label: string, operation: () => Promise<T>) =>
    runTimedOperation(label, operation, log);
  const requirements = await resolveMarketContextRunRequirements(params);
  const readableSources = (
    Object.entries(requirements) as Array<
      [
        StrategyMarketContextSource,
        MarketContextRunRequirements[StrategyMarketContextSource],
      ]
    >
  )
    .filter(([, requirement]) => requirement.read)
    .map(([source]) => source);
  if (readableSources.length) {
    await timeOperation('market context schema ensure', () =>
      ensureMarketContextSchemas(readableSources),
    );
  }

  if (requirements.derivatives.backfill) {
    await timeOperation('derivatives context backfill', () =>
      (params.mode === 'signals'
        ? backfillDerivativesContextForSignals
        : backfillDerivativesContextForBacktest)(
        buildDerivativesBackfillParams(params),
      ),
    );
  }

  if (requirements.hyperliquidWhales.backfill) {
    await timeOperation('hyperliquid whale context backfill', () =>
      backfillHyperliquidWhaleContext({
        startMs: params.preloadStartMs ?? params.startMs,
        endMs: params.endMs,
        cacheOnly: params.cacheOnly,
        strict: false,
        log,
      }),
    );
  }

  if (requirements.binance.backfill) {
    await timeOperation('binance market context backfill', () => {
      const backfill =
        params.mode === 'backtest'
          ? backfillBinanceMarketContextForBacktest
          : params.mode === 'signals'
            ? backfillBinanceMarketContextForSignals
            : backfillBinanceMarketContextForReplay;

      return backfill(buildBinanceMarketBackfillParams(params));
    });
  }

  if (requirements.coinmarketcap.backfill) {
    await timeOperation('coinmarketcap historical context backfill', () =>
      resolveCoinMarketCapBackfillForMode(params.mode)(
        buildCoinMarketCapBackfillParams(params),
      ),
    );
  }
  return requirements;
};
