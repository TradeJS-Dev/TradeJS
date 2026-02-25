import { askAI } from '@utils/ai';
import { logger } from '@utils/logger';
import { fetchMlThreshold } from '@utils/mlGrpc';
import {
  Connector,
  Direction,
  Signal,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
  Tp,
} from '@types';

interface EnrichSignalWithMlAiParams {
  signal: Signal;
  symbol: string;
  direction: Direction;
  env: string;
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
}

export const enrichSignalWithMlAi = async ({
  signal,
  symbol,
  direction,
  env,
  ml,
  ai,
}: EnrichSignalWithMlAiParams): Promise<number | undefined> => {
  if (env !== 'BACKTEST' && ml && ml.enabled !== false) {
    const mlResult = await fetchMlThreshold(signal, {
      strategyConfig: ml.strategyConfig,
      ML_THRESHOLD: ml.mlThreshold,
    });

    if (mlResult) {
      signal.ml = mlResult;
    }
  }

  if (env === 'BACKTEST' || ai?.enabled === false) {
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
