import { logger } from '@tradejs/infra/logger';
import { redisKeys, setData } from '@tradejs/infra/redis';
import {
  buildMlFeatures,
  buildMlTrainingRow,
  fetchMlThreshold,
  trimMlTrainingRowWindows,
} from '@tradejs/infra/ml';
import {
  Connector,
  Direction,
  Signal,
  SignalAnalysis,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
  Tp,
} from '@tradejs/types';
import { askAI, runAiPromptLocal } from '../ai';
import { buildMlPayload } from '../mlPayload';
import { getTradejsProjectCwd } from '../tradejsConfig';
import {
  createRuntimeOrderId,
  recordRuntimeTradeOpen,
} from '../runtimeJournal';
import { enrichSignalWithDerivativesContext } from './derivativesContext';
import { enrichSignalWithBinanceMarketContext } from './binanceMarketContext';

interface EnrichSignalWithMlAiParams {
  signal: Signal;
  userName?: string;
  symbol: string;
  direction: Direction;
  env: string;
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
}

const formatAiError = (err: unknown): string => {
  const error = err as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    type?: unknown;
    error?: unknown;
  };

  const safeJson = (value: unknown) => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const details = {
    message: String(error?.message ?? 'unknown'),
    status: error?.status ?? null,
    code: error?.code ?? null,
    type: error?.type ?? null,
    providerError: error?.error ?? null,
  };

  return safeJson(details);
};

const resolveAiQuality = (
  analysis: Partial<SignalAnalysis> | undefined,
  direction: Direction,
): number | undefined => {
  if (typeof analysis?.quality !== 'number') {
    return undefined;
  }

  const normalizedQuality = Math.round(analysis.quality);
  const aiApprovedCurrentTrade = analysis.direction === direction;
  // Direction mismatch should penalize quality instead of hard-blocking.
  return aiApprovedCurrentTrade ? normalizedQuality : 0;
};

const findReplayAiAnalysis = ({
  signal,
  direction,
  ai,
}: {
  signal: Signal;
  direction: Direction;
  ai?: StrategyRuntimeAiOptions;
}): Partial<SignalAnalysis> | undefined => {
  const snapshots = ai?.replayAnalyses;
  if (!Array.isArray(snapshots) || !snapshots.length) {
    return undefined;
  }

  let best: { diff: number; analysis: Partial<SignalAnalysis> } | null = null;

  for (const snapshot of snapshots) {
    if (
      snapshot.symbol !== signal.symbol ||
      snapshot.direction !== direction ||
      (snapshot.strategy && snapshot.strategy !== signal.strategy)
    ) {
      continue;
    }

    const toleranceMs = Math.max(0, Number(snapshot.toleranceMs ?? 0));
    const diff = Math.abs(snapshot.timestamp - signal.timestamp);
    if (diff > toleranceMs || (best && diff >= best.diff)) {
      continue;
    }

    best = {
      diff,
      analysis: snapshot.analysis,
    };
  }

  return best?.analysis;
};

export const enrichSignalWithMl = async ({
  signal,
  env,
  ml,
}: Pick<
  EnrichSignalWithMlAiParams,
  'signal' | 'env' | 'ml'
>): Promise<void> => {
  if (
    env !== 'BACKTEST' &&
    ml &&
    ml.enabled !== false &&
    ml.strategyConfig &&
    typeof ml.mlThreshold === 'number'
  ) {
    const strategy = signal.strategy;
    const fullRow = buildMlTrainingRow(
      buildMlPayload({
        signal,
        context: {
          strategyConfig: ml.strategyConfig,
          strategyName: strategy,
          symbol: signal.symbol,
        },
      }),
      null,
    );
    const row = trimMlTrainingRowWindows(fullRow, 5);
    const features = buildMlFeatures(row);
    const mlResult = await fetchMlThreshold({
      strategy,
      features,
      threshold: ml.mlThreshold,
      projectRoot: getTradejsProjectCwd(),
    });

    if (mlResult) {
      signal.ml = mlResult;
    }
  }
};

export const enrichSignalWithAi = async ({
  signal,
  symbol,
  userName,
  direction,
  env,
  ai,
}: Pick<
  EnrichSignalWithMlAiParams,
  'signal' | 'userName' | 'symbol' | 'direction' | 'env' | 'ai'
>): Promise<number | undefined> => {
  if (ai?.enabled === false) {
    return undefined;
  }

  if (env === 'PARITY') {
    const replayAnalysis = findReplayAiAnalysis({ signal, direction, ai });
    if (replayAnalysis) {
      signal.aiAnalysis = replayAnalysis;
      return resolveAiQuality(replayAnalysis, direction);
    }
  }

  if (env === 'BACKTEST') {
    return undefined;
  }

  if (ai?.mode === 'gate') {
    const gateAnalysis = await runAiPromptLocal(signal);
    const gateQuality = resolveAiQuality(gateAnalysis, direction);
    signal.aiAnalysis = gateAnalysis;
    return gateQuality;
  }

  try {
    const analysis = await askAI(signal, { userName });
    signal.aiAnalysis = analysis;
    return resolveAiQuality(analysis, direction);
  } catch (err) {
    logger.error('AI analysis error: %s %s', symbol, formatAiError(err));
  }

  return undefined;
};

export const enrichSignalWithMlAi = async ({
  signal,
  userName,
  symbol,
  direction,
  env,
  ml,
  ai,
}: EnrichSignalWithMlAiParams): Promise<number | undefined> => {
  await enrichSignalWithBinanceMarketContext({ signal, env });
  await enrichSignalWithDerivativesContext({ signal, env });
  await enrichSignalWithMl({ signal, env, ml });
  return enrichSignalWithAi({ signal, userName, symbol, direction, env, ai });
};

interface ExecuteEntryOrderParams {
  connector: Connector;
  userName?: string;
  symbol: string;
  direction: Direction;
  qty: number;
  currentPrice: number;
  timestamp: number;
  takeProfits: Tp[];
  stopLossPrice: number | null;
  signal: Signal;
  beforePlaceOrder?: () => Promise<void>;
  recordRuntimeTrade?: boolean;
}

const applyProtectiveOrders = async ({
  connector,
  symbol,
  direction,
  qty,
  takeProfits,
  stopLossPrice,
}: {
  connector: Connector;
  symbol: string;
  direction: Direction;
  qty?: number;
  takeProfits: Tp[];
  stopLossPrice: number | null;
}) => {
  if (Array.isArray(takeProfits) && takeProfits.length > 0) {
    const tpOk = await connector.setTakeProfits({
      symbol,
      direction,
      qty,
      takeProfits,
    });

    if (!tpOk) {
      throw new Error('SET_TAKE_PROFITS_FAILED');
    }
  }

  if (typeof stopLossPrice === 'number' && Number.isFinite(stopLossPrice)) {
    const slOk = await connector.setStopLoss({
      symbol,
      direction,
      stopLossPrice,
    });

    if (!slOk) {
      throw new Error('SET_STOP_LOSS_FAILED');
    }
  }
};

export const executeEntryOrder = async ({
  connector,
  userName,
  symbol,
  direction,
  qty,
  currentPrice,
  timestamp,
  takeProfits,
  stopLossPrice,
  signal,
  beforePlaceOrder,
  recordRuntimeTrade = true,
}: ExecuteEntryOrderParams): Promise<number> => {
  await beforePlaceOrder?.();
  const orderId = signal.orderId || createRuntimeOrderId(signal.strategy);
  signal.orderId = orderId;
  signal.orderFailureReason = undefined;

  const orderPlaced = await connector.placeOrder({
    symbol,
    qty,
    price: currentPrice,
    isLimit: false,
    timestamp,
    direction,
    orderId,
    signal,
  });

  if (orderPlaced) {
    try {
      await applyProtectiveOrders({
        connector,
        symbol,
        direction,
        qty,
        takeProfits,
        stopLossPrice,
      });
    } catch (error) {
      await connector.closePosition({
        symbol,
        price: currentPrice,
        timestamp,
        direction,
      });
      throw error;
    }
  }

  signal.orderStatus = orderPlaced ? 'completed' : 'failed';
  signal.orderSkipReason = undefined;
  if (orderPlaced) {
    signal.orderFailureReason = undefined;
  }

  const currentPosition = await connector.getPosition(symbol);
  const entryPrice =
    currentPosition?.price && Number.isFinite(currentPosition.price)
      ? currentPosition.price
      : currentPrice;

  signal.prices.currentPrice = entryPrice;

  if (orderPlaced && recordRuntimeTrade) {
    await recordRuntimeTradeOpen({
      userName,
      orderId,
      signalId: signal.signalId,
      strategy: signal.strategy,
      symbol,
      direction,
      qty,
      entryPrice,
      entryTimestamp: timestamp,
      ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
    });
  }

  if (currentPosition?.price) {
    return currentPosition.price;
  }

  return entryPrice;
};

export const updatePositionProtection = async ({
  connector,
  symbol,
  direction,
  qty,
  takeProfits,
  stopLossPrice,
}: {
  connector: Connector;
  symbol: string;
  direction: Direction;
  qty?: number;
  takeProfits?: Tp[];
  stopLossPrice?: number | null;
}) => {
  await applyProtectiveOrders({
    connector,
    symbol,
    direction,
    qty,
    takeProfits: takeProfits ?? [],
    stopLossPrice: stopLossPrice ?? null,
  });
};
