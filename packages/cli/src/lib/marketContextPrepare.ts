import chalk from 'chalk';
import type { Interval } from '@tradejs/types';
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
  backfillCoingeckoGlobalContextForBacktest,
  backfillCoingeckoGlobalContextForReplay,
  backfillCoingeckoGlobalContextForSignals,
  shouldBackfillCoingeckoGlobalContextForBacktest,
  shouldBackfillCoingeckoGlobalContextForReplay,
  shouldBackfillCoingeckoGlobalContextForSignals,
} from './coingeckoGlobalMarketContextBackfill';
import { timeOperation as runTimedOperation } from './runFormatting';

export type MarketContextRunMode = 'backtest' | 'signals' | 'replay' | 'parity';

export type PrepareMarketContextForRunParams = {
  mode: MarketContextRunMode;
  userName: string;
  projectRoot: string;
  symbols: string[];
  interval: Interval;
  startMs: number;
  endMs: number;
  preloadStartMs?: number;
  cacheOnly: boolean;
  aiEnabled?: boolean;
  mlEnabled?: boolean;
  log?: (message: string) => void;
};

export const shouldPrepareDerivativesContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled'
  >,
) => {
  if (params.mode === 'signals') {
    return shouldBackfillDerivativesContextForSignals({
      cacheOnly: params.cacheOnly,
    });
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
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled'
  >,
) => {
  if (params.mode === 'backtest') {
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

export const shouldPrepareCoingeckoGlobalContextForRun = (
  params: Pick<
    PrepareMarketContextForRunParams,
    'mode' | 'cacheOnly' | 'aiEnabled' | 'mlEnabled'
  >,
) => {
  if (params.mode === 'backtest') {
    return shouldBackfillCoingeckoGlobalContextForBacktest({
      aiEnabled: Boolean(params.aiEnabled),
      cacheOnly: params.cacheOnly,
      mlEnabled: Boolean(params.mlEnabled),
    });
  }

  if (params.mode === 'signals') {
    return shouldBackfillCoingeckoGlobalContextForSignals({
      cacheOnly: params.cacheOnly,
    });
  }

  return shouldBackfillCoingeckoGlobalContextForReplay({
    cacheOnly: params.cacheOnly,
  });
};

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

  if (shouldPrepareDerivativesContextForRun(params)) {
    await timeOperation('derivatives context backfill', () =>
      (params.mode === 'signals'
        ? backfillDerivativesContextForSignals
        : backfillDerivativesContextForBacktest)({
        userName: params.userName,
        symbols: params.symbols,
        startMs: params.startMs,
        endMs: params.endMs,
        preloadStartMs: params.preloadStartMs,
      }),
    );
  }

  if (shouldPrepareBinanceMarketContextForRun(params)) {
    await timeOperation('binance market context backfill', () => {
      const backfill =
        params.mode === 'backtest'
          ? backfillBinanceMarketContextForBacktest
          : params.mode === 'signals'
            ? backfillBinanceMarketContextForSignals
            : backfillBinanceMarketContextForReplay;

      return backfill({
        userName: params.userName,
        projectRoot: params.projectRoot,
        symbols: params.symbols,
        interval: params.interval,
        startMs: params.startMs,
        endMs: params.endMs,
        preloadStartMs: params.preloadStartMs,
      });
    });
  }

  if (shouldPrepareCoingeckoGlobalContextForRun(params)) {
    await timeOperation('coingecko global market context backfill', () => {
      const backfill =
        params.mode === 'backtest'
          ? backfillCoingeckoGlobalContextForBacktest
          : params.mode === 'signals'
            ? backfillCoingeckoGlobalContextForSignals
            : backfillCoingeckoGlobalContextForReplay;

      return backfill({
        startMs: params.startMs,
        endMs: params.endMs,
      });
    });
  }
};
