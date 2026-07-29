import chalk from 'chalk';
import type { Interval, MarketUniverse } from '@tradejs/types';
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
  log?: (message: string) => void;
};

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

  if (shouldPrepareDerivativesContextForRun(params)) {
    await timeOperation('derivatives context backfill', () =>
      (params.mode === 'signals'
        ? backfillDerivativesContextForSignals
        : backfillDerivativesContextForBacktest)(
        buildDerivativesBackfillParams(params),
      ),
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

      return backfill(buildBinanceMarketBackfillParams(params));
    });
  }

  if (shouldPrepareCoinMarketCapContextForRun(params)) {
    await timeOperation('coinmarketcap historical context backfill', () =>
      resolveCoinMarketCapBackfillForMode(params.mode)(
        buildCoinMarketCapBackfillParams(params),
      ),
    );
  }
};
