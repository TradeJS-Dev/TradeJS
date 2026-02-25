import {
  Connector,
  Direction,
  Interval,
  KlineChartData,
  KlineChartItem,
  Signal,
  Tp,
} from './trade';
import { StrategyConfig } from './backtest';

export interface StrategySignalMetaParams {
  symbol: string;
  interval: Interval;
  direction: Direction;
  timestamp: number;
  configFromBacktest: boolean;
}

export interface StrategySignalPriceParams {
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
}

export interface StrategyEntryBaseParams {
  qty: number;
}

export interface StrategyEntryTakeProfitsParams {
  takeProfits: Tp[];
}

export interface StrategyEntryRuntimeBaseParams {
  symbol: string;
  direction: Direction;
  timestamp: number;
  currentPrice: number;
}

export type StrategyEntryRuntimeBuilderParams<TExtra extends object = {}> =
  StrategyEntryRuntimeBaseParams & TExtra;

export type StrategyEntrySignalDecisionBuilderParams<
  TPriceFields extends object = StrategySignalPriceParams,
  TExtra extends object = {},
> = StrategySignalMetaParams & StrategyEntryBaseParams & TPriceFields & TExtra;

export type StrategyIndicatorsMap = Signal['indicators'];
export type StrategyAdditionalIndicatorsMap = NonNullable<
  Signal['additionalIndicators']
>;

export interface BuildStrategySignalParams {
  signalId: string;
  strategy: Signal['strategy'];
  symbol: string;
  interval: Signal['interval'];
  direction: Direction;
  timestamp: number;
  prices: Signal['prices'];
  figures?: Signal['figures'];
  indicators?: Signal['indicators'];
  additionalIndicators?: NonNullable<Signal['additionalIndicators']>;
  configFromBacktest?: boolean;
}

export type BuildStrategySignalDraft = Omit<BuildStrategySignalParams, 'signalId'> & {
  signalId?: string;
};

export interface StrategyEntrySignalContext {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  direction: Signal['direction'];
  timestamp: Signal['timestamp'];
  prices: Signal['prices'];
  configFromBacktest?: Signal['configFromBacktest'];
}

export interface StrategyRuntimeMlOptions {
  enabled?: boolean;
  strategyConfig?: StrategyConfig;
  mlThreshold?: number;
}

export interface StrategyRuntimeAiOptions {
  enabled?: boolean;
  minQuality?: number;
}

export interface StrategyEntryRuntimeOptions {
  ml?: StrategyRuntimeMlOptions;
  ai?: StrategyRuntimeAiOptions;
  beforePlaceOrder?: () => Promise<void>;
}

export interface StrategyEntryOrderPlan {
  qty: number;
  takeProfits?: Tp[];
}

export interface StrategyClosePlan {
  price: number;
  timestamp: number;
  direction: Direction;
}

export type StrategyDecision =
  | {
      kind: 'skip';
      code: string;
    }
  | {
      kind: 'entry';
      code: string;
      entryContext: StrategyEntrySignalContext;
      orderPlan: StrategyEntryOrderPlan;
      signal?: Signal;
      runtime?: StrategyEntryRuntimeOptions;
    }
  | {
      kind: 'exit';
      code: string;
      closePlan: StrategyClosePlan;
    };

export interface CreateStrategyCoreParams<TConfig extends StrategyConfig> {
  userName: string;
  symbol: string;
  config: TConfig;
  configFromBacktest: boolean;
  connector: Connector;
  data: KlineChartData;
  btcData: KlineChartData;
}

export type StrategyCoreRunner = (
  candle: KlineChartItem,
  btcCandle: KlineChartItem,
) => Promise<StrategyDecision> | StrategyDecision;
