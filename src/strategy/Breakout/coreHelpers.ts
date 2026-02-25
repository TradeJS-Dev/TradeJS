import {
  StrategyDecision,
  StrategyEntryTakeProfitsParams,
  StrategyEntrySignalDecisionBuilderParams,
  StrategySignalPriceParams,
} from '@types';
import { buildEntrySignalDecision } from '@utils/strategyHelpers';
type BreakoutSignalIndicators = {
  maFast: number;
  maSlow: number;
  obv: number;
  smaObv: number;
  atr: number;
  bbUpper: number;
  bbLower: number;
  correlation: number;
  highLevel: number;
  lowLevel: number;
};

type BreakoutEntrySignalDecisionParams =
  StrategyEntrySignalDecisionBuilderParams<
    Omit<StrategySignalPriceParams, 'riskRatio'>,
    {
      code: string;
      indicators: BreakoutSignalIndicators;
      signals: Record<string, boolean>;
    } & StrategyEntryTakeProfitsParams
  > & {
    configFromBacktest: boolean;
  };

export const buildBreakoutEntrySignalDecision = ({
  code,
  symbol,
  interval,
  direction,
  timestamp,
  currentPrice,
  qty,
  takeProfitPrice,
  stopLossPrice,
  takeProfits,
  indicators,
  signals,
  configFromBacktest,
}: BreakoutEntrySignalDecisionParams): StrategyDecision => {
  return buildEntrySignalDecision({
    code,
    entryContext: {
      strategy: 'Breakout',
      symbol,
      interval,
      direction,
      timestamp,
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio: 0,
      },
      configFromBacktest,
    },
    figures: {},
    indicators: {
      maFast: indicators.maFast,
      maSlow: indicators.maSlow,
      obv: indicators.obv,
      smaObv: indicators.smaObv,
      atr: indicators.atr,
      bbUpper: indicators.bbUpper,
      bbLower: indicators.bbLower,
      correlation: indicators.correlation,
    },
    additionalIndicators: {
      highLevel: indicators.highLevel,
      lowLevel: indicators.lowLevel,
      signals,
    },
    orderPlan: {
      qty,
      takeProfits,
    },
    runtime: {
      ai: {
        enabled: false,
      },
    },
  });
};
