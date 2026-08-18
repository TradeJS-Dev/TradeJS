import { logger } from '@tradejs/infra/logger';
import { FEE_PERCENT } from '@tradejs/core/constants';
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
  RuntimeTradeFillSource,
  RuntimeTradeTelemetryQuality,
  Tp,
} from '@tradejs/types';
import { askAI, runAiPromptLocal } from '../ai';
import { buildMlPayload } from '../mlPayload';
import { getTradejsProjectCwd } from '../tradejsConfig';
import {
  createRuntimeOrderId,
  recordRuntimeTradeIncrease,
  recordRuntimeTradeOpen,
} from '../runtimeJournal';
import { enrichSignalWithMarketContextStages } from './marketContextStages';

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
      strategy: ml.modelKey ?? strategy,
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
  await enrichSignalWithMarketContextStages({ signal, env });
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
  positionIntent?: 'open' | 'increase';
  leverage?: number;
  signal: Signal;
  beforePlaceOrder?: () => Promise<void>;
  recordRuntimeTrade?: boolean;
}

const toFiniteNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const getOrderArrivalSnapshot = async ({
  connector,
  symbol,
}: {
  connector: Connector;
  symbol: string;
}) => {
  if (typeof connector.getTopOfBookTicker !== 'function') {
    return {
      arrivalSnapshotTime: Date.now(),
      arrivalSource: 'unavailable',
      bid: null,
      ask: null,
      arrivalMid: null,
      spreadBps: null,
    };
  }

  try {
    const ticker = await connector.getTopOfBookTicker(symbol);
    const arrivalSnapshotTime = toFiniteNumberOrNull(ticker?.timestamp);
    const bid = toFiniteNumberOrNull(ticker?.bidPrice);
    const ask = toFiniteNumberOrNull(ticker?.askPrice);
    const arrivalMid = bid != null && ask != null ? (bid + ask) / 2 : null;
    const spreadBps =
      bid != null && ask != null && arrivalMid != null && arrivalMid > 0
        ? ((ask - bid) / arrivalMid) * 10_000
        : null;

    return {
      arrivalSnapshotTime: arrivalSnapshotTime ?? Date.now(),
      arrivalSource: 'top_of_book',
      bid,
      ask,
      arrivalMid,
      spreadBps,
    };
  } catch (error) {
    logger.warn(
      'runtime order arrival snapshot failed: %s %s',
      symbol,
      (error as Error)?.message || String(error),
    );
    return {
      arrivalSnapshotTime: Date.now(),
      arrivalSource: 'top_of_book_error',
      bid: null,
      ask: null,
      arrivalMid: null,
      spreadBps: null,
    };
  }
};

export const validateEntryProtectionAtArrival = ({
  direction,
  signalPrice,
  bid,
  ask,
  arrivalMid,
  takeProfits,
  stopLossPrice,
}: {
  direction: Direction;
  signalPrice: number;
  bid: number | null;
  ask: number | null;
  arrivalMid: number | null;
  takeProfits: Tp[];
  stopLossPrice: number | null;
}) => {
  const entryReference =
    direction === 'LONG'
      ? ask ?? arrivalMid ?? signalPrice
      : bid ?? arrivalMid ?? signalPrice;
  const stopReference =
    direction === 'LONG'
      ? bid ?? arrivalMid ?? signalPrice
      : ask ?? arrivalMid ?? signalPrice;
  if (
    !Number.isFinite(entryReference) ||
    entryReference <= 0 ||
    !Number.isFinite(stopReference) ||
    stopReference <= 0
  ) {
    throw new Error('INVALID_ENTRY_REFERENCE_AT_ARRIVAL');
  }

  for (const takeProfit of takeProfits) {
    if (
      !Number.isFinite(takeProfit.price) ||
      takeProfit.price <= 0 ||
      (direction === 'LONG'
        ? takeProfit.price <= entryReference
        : takeProfit.price >= entryReference)
    ) {
      throw new Error('TAKE_PROFIT_CROSSED_BEFORE_ENTRY');
    }
  }

  if (
    stopLossPrice != null &&
    (!Number.isFinite(stopLossPrice) ||
      stopLossPrice <= 0 ||
      (direction === 'LONG'
        ? stopLossPrice >= stopReference
        : stopLossPrice <= stopReference))
  ) {
    throw new Error('STOP_LOSS_CROSSED_BEFORE_ENTRY');
  }
};

const resolveRuntimeTelemetryQuality = ({
  signalClosePrice,
  arrivalMid,
  orderSubmitTime,
  orderAckTime,
  fillAvgPrice,
  fillTime,
}: {
  signalClosePrice: number | null;
  arrivalMid: number | null;
  orderSubmitTime: number | null;
  orderAckTime: number | null;
  fillAvgPrice: number | null;
  fillTime: number | null;
}): RuntimeTradeTelemetryQuality => {
  if (
    signalClosePrice != null &&
    arrivalMid != null &&
    orderSubmitTime != null &&
    orderAckTime != null &&
    fillAvgPrice != null &&
    fillTime != null
  ) {
    return 'full';
  }

  if (fillAvgPrice != null && (arrivalMid != null || orderSubmitTime != null)) {
    return 'partial';
  }

  if (fillAvgPrice != null) {
    return 'price_only';
  }

  return 'none';
};

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
  positionIntent = 'open',
  signal,
  beforePlaceOrder,
  recordRuntimeTrade = true,
  leverage,
}: ExecuteEntryOrderParams): Promise<number> => {
  await beforePlaceOrder?.();
  const previousPosition =
    positionIntent === 'increase' ? await connector.getPosition(symbol) : null;
  const orderId = signal.orderId || createRuntimeOrderId(signal.strategy);
  const signalTimestamp = signal.timestamp;
  const signalClosePrice = currentPrice;
  signal.orderId = orderId;
  signal.orderQty = qty;
  signal.orderValue = qty * currentPrice;
  signal.orderFailureReason = undefined;

  const arrivalSnapshot = await getOrderArrivalSnapshot({ connector, symbol });
  try {
    validateEntryProtectionAtArrival({
      direction,
      signalPrice: currentPrice,
      bid: arrivalSnapshot.bid,
      ask: arrivalSnapshot.ask,
      arrivalMid: arrivalSnapshot.arrivalMid,
      takeProfits,
      stopLossPrice,
    });
  } catch (error) {
    signal.orderStatus = 'failed';
    signal.orderFailureReason = (error as Error).message;
    throw error;
  }
  const orderSubmitTime = Date.now();
  const orderPlaced = await connector.placeOrder({
    symbol,
    qty,
    price: currentPrice,
    isLimit: false,
    positionIntent,
    timestamp,
    direction,
    ...(typeof leverage === 'number' && Number.isFinite(leverage)
      ? { leverage }
      : {}),
    orderId,
    signal,
  });
  const orderAckTime = Date.now();
  const placedQty =
    typeof signal.orderQty === 'number' &&
    Number.isFinite(signal.orderQty) &&
    signal.orderQty > 0
      ? signal.orderQty
      : qty;
  const currentPosition = await connector.getPosition(symbol);
  const fillTime = Date.now();
  const isPositionIncrease =
    positionIntent === 'increase' &&
    previousPosition?.direction === direction &&
    Number.isFinite(previousPosition.qty) &&
    previousPosition.qty > 0;
  const hasRefreshedIncreasedPosition = Boolean(
    isPositionIncrease &&
      previousPosition &&
      currentPosition?.qty &&
      currentPosition.qty > previousPosition.qty,
  );
  const hasUsableCurrentPosition = Boolean(
    currentPosition &&
      Number.isFinite(currentPosition.price) &&
      Number.isFinite(currentPosition.qty) &&
      (!isPositionIncrease || hasRefreshedIncreasedPosition),
  );
  const resultingEntryPrice =
    hasUsableCurrentPosition && currentPosition
      ? currentPosition.price
      : isPositionIncrease && previousPosition
        ? (previousPosition.price * previousPosition.qty +
            currentPrice * placedQty) /
          (previousPosition.qty + placedQty)
        : currentPrice;
  const resultingQty =
    hasUsableCurrentPosition && currentPosition
      ? currentPosition.qty
      : isPositionIncrease && previousPosition
        ? previousPosition.qty + placedQty
        : placedQty;
  const filledQty =
    isPositionIncrease && previousPosition
      ? hasRefreshedIncreasedPosition && currentPosition
        ? currentPosition.qty - previousPosition.qty
        : placedQty
      : resultingQty;
  const fillPrice =
    isPositionIncrease &&
    previousPosition &&
    hasRefreshedIncreasedPosition &&
    currentPosition
      ? (resultingEntryPrice * currentPosition.qty -
          previousPosition.price * previousPosition.qty) /
        (currentPosition.qty - previousPosition.qty)
      : isPositionIncrease
        ? currentPrice
        : resultingEntryPrice;
  const fillSource: RuntimeTradeFillSource = hasUsableCurrentPosition
    ? 'exchange_position'
    : orderPlaced
      ? 'requested_price'
      : 'unknown';
  const estimatedOpenFee = fillPrice * filledQty * FEE_PERCENT;

  signal.prices.currentPrice = fillPrice;
  signal.orderQty = filledQty;
  signal.orderValue = filledQty * fillPrice;

  if (orderPlaced) {
    try {
      await applyProtectiveOrders({
        connector,
        symbol,
        direction,
        qty: resultingQty,
        takeProfits,
        stopLossPrice,
      });
    } catch (error) {
      await connector.closePosition({
        symbol,
        price: resultingEntryPrice,
        timestamp,
        direction,
        signal,
      });
      throw error;
    }
  }

  signal.orderStatus = orderPlaced ? 'completed' : 'failed';
  signal.orderSkipReason = undefined;
  if (orderPlaced) {
    signal.orderFailureReason = undefined;
  }

  if (orderPlaced && recordRuntimeTrade && !isPositionIncrease) {
    await recordRuntimeTradeOpen({
      userName,
      orderId,
      signalId: signal.signalId,
      strategy: signal.strategy,
      symbol,
      interval: signal.interval,
      direction,
      qty: resultingQty,
      entryPrice: resultingEntryPrice,
      signalTimestamp,
      signalClosePrice,
      arrivalSnapshotTime: arrivalSnapshot.arrivalSnapshotTime,
      arrivalSource: arrivalSnapshot.arrivalSource,
      arrivalMid: arrivalSnapshot.arrivalMid,
      bid: arrivalSnapshot.bid,
      ask: arrivalSnapshot.ask,
      spreadBps: arrivalSnapshot.spreadBps,
      orderSubmitTime,
      orderAckTime,
      fillAvgPrice: fillPrice,
      fillSource,
      fillTime,
      telemetryQuality: resolveRuntimeTelemetryQuality({
        signalClosePrice,
        arrivalMid: arrivalSnapshot.arrivalMid,
        orderSubmitTime,
        orderAckTime,
        fillAvgPrice: fillPrice,
        fillTime,
      }),
      fee: estimatedOpenFee,
      openFee: estimatedOpenFee,
      totalFee: estimatedOpenFee,
      entryTimestamp: timestamp,
      universe: signal.universe,
      assetClass: signal.assetClass,
      accountId: signal.accountId,
      deploymentId: signal.deploymentId,
      policyProfileId: signal.policyProfileId,
      runtimeConfigId: signal.runtimeConfigId,
      runtimeReleaseVersion: signal.runtimeReleaseVersion,
      runtimeLineage: signal.runtimeLineage,
      ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
    });
  }

  if (orderPlaced && recordRuntimeTrade && isPositionIncrease) {
    await recordRuntimeTradeIncrease({
      userName,
      strategy: signal.strategy,
      symbol,
      direction,
      resultingQty,
      resultingEntryPrice,
      addedQty: filledQty,
      addedEntryPrice: fillPrice,
      entryTimestamp: timestamp,
      fee: estimatedOpenFee,
      accountId: signal.accountId,
      deploymentId: signal.deploymentId,
    });
  }

  if (hasUsableCurrentPosition && currentPosition?.price) {
    return currentPosition.price;
  }

  return resultingEntryPrice;
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
