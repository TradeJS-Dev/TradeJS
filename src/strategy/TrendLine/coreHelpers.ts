import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import {
  Connector,
  Direction,
  Interval,
  StrategyDecision,
  StrategyIndicatorsMap,
  StrategySignalPriceParams,
  TrendLine,
} from '@types';
import {
  buildEntrySignalDecision,
} from '@utils/strategyHelpers';
import { TrendLineConfig } from './config';
import { trendLineManifest } from './manifest';

type TrendLineEntryRuntimeConfig = Pick<
  TrendLineConfig,
  | 'CLOSE_OPPOSITE_POSITIONS'
  | 'ML_THRESHOLD'
  | 'MIN_AI_QUALITY'
  | 'AI_ENABLED'
  | 'TRENDLINE'
  | 'HIGHS'
  | 'LOWS'
>;

interface BuildTrendlineEntrySignalDecisionParams {
  symbol: string;
  interval: Interval;
  direction: Direction;
  timestamp: number;
  bestLine: TrendLine;
  prices: StrategySignalPriceParams;
  qty: number;
  indicatorHistory: StrategyIndicatorsMap;
  configFromBacktest: boolean;
  connector: Connector;
  config: TrendLineEntryRuntimeConfig;
}

export const buildTrendlineEntrySignalDecision = ({
  symbol,
  interval,
  direction,
  timestamp,
  bestLine,
  prices,
  indicatorHistory,
  configFromBacktest,
  qty,
  connector,
  config,
}: BuildTrendlineEntrySignalDecisionParams): StrategyDecision => {
  const closeOppositePositions = Boolean(config.CLOSE_OPPOSITE_POSITIONS);
  const mlThreshold = Number(config.ML_THRESHOLD ?? 0);
  const minAiQuality = Number(config.MIN_AI_QUALITY ?? 4);
  const aiEnabled = Boolean(config.AI_ENABLED ?? true);
  const trendlineConfig = config.TRENDLINE ?? {};
  const highs = config.HIGHS ?? {};
  const lows = config.LOWS ?? {};
  const entryContext = {
    strategy: trendLineManifest.name,
    symbol,
    interval,
    direction,
    timestamp,
    prices,
    configFromBacktest,
  } as const;

  return buildEntrySignalDecision({
    code: 'TRENDLINE_SIGNAL',
    entryContext,
    figures: {
      trendLine: bestLine,
    },
    indicators: indicatorHistory,
    additionalIndicators: {
      touches: bestLine.touches.length + 2,
      distance: bestLine.distance,
    },
    orderPlan: {
      qty,
      takeProfits: [{ rate: 1, price: prices.takeProfitPrice }],
    },
    runtime: {
      ml: {
        enabled: true,
        strategyConfig: {
          TRENDLINE_CONFIG: trendlineConfig,
          HIGHS: highs,
          LOWS: lows,
        },
        mlThreshold,
      },
      ai: {
        enabled: aiEnabled,
        minQuality: minAiQuality,
      },
      beforePlaceOrder: closeOppositePositions
        ? async () => {
            await closeOppositePositionsBeforeOpen({
              connector,
              entryContext,
            });
          }
        : undefined,
    },
  });
};
