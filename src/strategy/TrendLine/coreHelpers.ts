import { closeOppositePositionsBeforeOpen } from '@utils/closeOppositePositionsBeforeOpen';
import {
  Connector,
  Direction,
  StrategyDecision,
  StrategyEntryBaseParams,
  StrategyEntryRuntimeBuilderParams,
  StrategyEntrySignalDecisionBuilderParams,
  StrategyIndicatorsMap,
  StrategySignalPriceParams,
  TrendLine,
} from '@types';
import {
  buildEntryOrderPlan,
  buildEntryRuntimePolicy,
  buildEntrySignalDecision,
  buildMlRuntimeOptions,
} from '@utils/strategyHelpers';
import { TrendLineConfig } from './config';

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

const buildTrendlineEntryRuntime = ({
  connector,
  symbol,
  direction,
  currentPrice,
  timestamp,
  config,
}: {
  connector: Connector;
  config: TrendLineEntryRuntimeConfig;
} & StrategyEntryRuntimeBuilderParams): ReturnType<typeof buildEntryRuntimePolicy> => {
  const closeOppositePositions = Boolean(config.CLOSE_OPPOSITE_POSITIONS);
  const mlThreshold = Number(config.ML_THRESHOLD ?? 0);
  const minAiQuality = Number(config.MIN_AI_QUALITY ?? 4);
  const aiEnabled = Boolean(config.AI_ENABLED ?? true);
  const trendlineConfig = config.TRENDLINE ?? {};
  const highs = config.HIGHS ?? {};
  const lows = config.LOWS ?? {};

  return buildEntryRuntimePolicy({
    ml: buildMlRuntimeOptions({
      strategyName: 'TrendLine',
      strategyConfig: {
        TRENDLINE_CONFIG: trendlineConfig,
        HIGHS: highs,
        LOWS: lows,
      },
      symbol,
      mlThreshold,
    }),
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
  });
};

export const buildTrendlineEntrySignalDecision = ({
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
  configFromBacktest,
  qty,
  connector,
  config,
}: StrategyEntrySignalDecisionBuilderParams<
  StrategySignalPriceParams,
  {
  bestLine: TrendLine;
  indicatorHistory: StrategyIndicatorsMap;
  connector: Connector;
  config: TrendLineEntryRuntimeConfig;
}
>): StrategyDecision => {
  return buildEntrySignalDecision({
    code: 'TRENDLINE_SIGNAL',
    signal: {
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
      },
      configFromBacktest,
    },
    orderPlan: buildEntryOrderPlan({
      qty,
      price: currentPrice,
      timestamp,
      direction,
      takeProfits: [{ rate: 1, price: takeProfitPrice }],
      stopLossPrice,
    }),
    runtime: buildTrendlineEntryRuntime({
      connector,
      symbol,
      direction,
      currentPrice,
      timestamp,
      config,
    }),
  });
};
