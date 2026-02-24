import {
  StrategyEntryRuntimeBuilderParams,
  StrategyEntryTakeProfitsParams,
  StrategyEntrySignalDecisionBuilderParams,
  StrategySignalPriceParams,
} from '@types';
import {
  buildEntryOrderPlan,
  buildEntryRuntimePolicy,
  buildEntrySignalDecision,
} from '@utils/strategyHelpers';
import { StrategyDecision } from '@utils/strategyRuntime';

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

type BreakoutEntrySignalDecisionParams = StrategyEntrySignalDecisionBuilderParams<
  Omit<StrategySignalPriceParams, 'riskRatio'>,
  {
    code: string;
    indicators: BreakoutSignalIndicators;
    signals: Record<string, boolean>;
  } & StrategyEntryTakeProfitsParams
> & {
  configFromBacktest: boolean;
};

const buildBreakoutEntryRuntime = (
  _params: StrategyEntryRuntimeBuilderParams,
) => buildEntryRuntimePolicy({ aiEnabled: false });

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
    signal: {
      strategy: 'Breakout',
      symbol,
      interval,
      direction,
      timestamp,
      figures: {},
      prices: {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio: 0,
      },
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
      configFromBacktest,
    },
    orderPlan: buildEntryOrderPlan({
      qty,
      price: currentPrice,
      timestamp,
      direction,
      takeProfits,
      stopLossPrice,
    }),
    runtime: buildBreakoutEntryRuntime({
      symbol,
      direction,
      timestamp,
      currentPrice,
    }),
  });
};
