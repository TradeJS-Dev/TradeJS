import { askAI } from '@utils/ai';
import { logger } from '@utils/logger';
import { fetchMlThreshold } from '@utils/mlGrpc';
import { Connector, Direction, Signal, Tp } from '@types';
import type { StrategyRuntimeMlOptions } from '@utils/strategyRuntime';

interface EnrichSignalWithMlAiParams {
  signal: Signal;
  symbol: string;
  direction: Direction;
  env: string;
  ml?: StrategyRuntimeMlOptions;
  aiEnabled?: boolean;
}

export const enrichSignalWithMlAi = async ({
  signal,
  symbol,
  direction,
  env,
  ml,
  aiEnabled = true,
}: EnrichSignalWithMlAiParams): Promise<number | undefined> => {
  if (env !== 'BACKTEST' && ml) {
    const mlResult = await fetchMlThreshold(signal, {
      strategyName: ml.strategyName,
      strategyConfig: ml.strategyConfig,
      symbol: ml.symbol,
      ML_THRESHOLD: ml.mlThreshold,
    });

    if (mlResult) {
      signal.ml = mlResult;
    }
  }

  if (env === 'BACKTEST' || !aiEnabled) {
    return undefined;
  }

  try {
    const analysis = await askAI(signal);
    const aiApprovedCurrentTrade = analysis?.direction === direction;
    if (aiApprovedCurrentTrade && typeof analysis?.quality === 'number') {
      return Math.round(analysis.quality);
    }
  } catch (err) {
    logger.error('AI analysis error: %s %s', symbol, err);
  }

  return undefined;
};

interface ExecuteEntryOrderParams {
  connector: Connector;
  symbol: string;
  direction: Direction;
  qty: number;
  currentPrice: number;
  timestamp: number;
  takeProfits: Tp[];
  stopLossPrice: number | null;
  signal: Signal;
  beforePlaceOrder?: () => Promise<void>;
}

export const executeEntryOrder = async ({
  connector,
  symbol,
  direction,
  qty,
  currentPrice,
  timestamp,
  takeProfits,
  stopLossPrice,
  signal,
  beforePlaceOrder,
}: ExecuteEntryOrderParams): Promise<number> => {
  await beforePlaceOrder?.();

  const orderPlaced = await connector.placeOrder(
    {
      symbol,
      qty,
      price: currentPrice,
      isLimit: false,
      timestamp,
      direction,
      signal,
    },
    takeProfits,
    stopLossPrice,
  );

  signal.orderStatus = orderPlaced ? 'completed' : 'failed';

  const currentPosition = await connector.getPosition(symbol);
  if (currentPosition?.price) {
    signal.prices.currentPrice = currentPosition.price;
    return currentPosition.price;
  }

  return currentPrice;
};
