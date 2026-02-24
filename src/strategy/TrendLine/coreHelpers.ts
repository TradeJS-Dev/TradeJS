import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import { StrategyDecision } from '@utils/strategyRuntime';
import {
  Connector,
  Direction,
  Signal,
  TrendLine,
} from '@types';
import { buildStrategySignal } from '@utils/strategyHelpers';

export const buildTrendlineSignal = ({
  signalId,
  symbol,
  interval,
  direction,
  timestamp,
  bestLine,
  currentPrice,
  takeProfitPrice,
  stopLossPrice,
  riskRatio,
  indicatorHistory,
  additionalIndicators,
  configFromBacktest,
}: {
  signalId: string;
  symbol: string;
  interval: Signal['interval'];
  direction: Signal['direction'];
  timestamp: number;
  bestLine: TrendLine;
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
  indicatorHistory: Signal['indicators'];
  additionalIndicators?: Record<string, any>;
  configFromBacktest: boolean;
}): Signal =>
  buildStrategySignal({
    signalId,
    strategy: 'TrendLine',
    symbol,
    interval,
    direction,
    timestamp,
    figures: {
      trendLine: bestLine,
    },
    prices: {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio,
    },
    indicators: indicatorHistory,
    additionalIndicators: {
      touches: bestLine.touches.length + 2,
      distance: bestLine.distance,
      ...additionalIndicators,
    },
    configFromBacktest,
  });

export const buildTrendlineEntryDecision = ({
  signal,
  qty,
  currentPrice,
  takeProfitPrice,
  stopLossPrice,
  direction,
  timestamp,
  connector,
  symbol,
  config,
}: {
  signal: Signal;
  qty: number;
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  direction: Direction;
  timestamp: number;
  connector: Connector;
  symbol: string;
  config: Record<string, any>;
}): StrategyDecision => {
  const closeOppositePositions = Boolean(config.CLOSE_OPPOSITE_POSITIONS);
  const mlThreshold = Number(config.ML_THRESHOLD ?? 0);
  const minAiQuality = Number(config.MIN_AI_QUALITY ?? 4);
  const aiEnabled = Boolean(config.AI_ENABLED ?? true);
  const trendlineConfig = config.TRENDLINE ?? {};
  const highs = config.HIGHS ?? {};
  const lows = config.LOWS ?? {};

  return {
    kind: 'entry',
    code: 'TRENDLINE_SIGNAL',
    signal,
    orderPlan: {
      qty,
      price: currentPrice,
      timestamp,
      direction,
      takeProfits: [{ rate: 1, price: takeProfitPrice }],
      stopLossPrice,
    },
    runtime: {
      ml: {
        strategyName: 'TrendLine',
        strategyConfig: {
          TRENDLINE_CONFIG: trendlineConfig,
          HIGHS: highs,
          LOWS: lows,
        },
        symbol,
        mlThreshold,
      },
      aiEnabled,
      minAiQuality,
      beforePlaceOrder: closeOppositePositions
        ? async () => {
            await closeOppositePositionsBeforeOpen({
              connector,
              currentSymbol: symbol,
              currentDirection: direction,
              price: currentPrice,
              timestamp,
              strategyName: 'TrendLine',
            });
          }
        : undefined,
    },
  };
};
