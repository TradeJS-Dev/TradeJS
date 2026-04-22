import {
  BacktestPriceMode,
  BuildStrategySignalDraft,
  BuildStrategySignalParams,
  Connector,
  Direction,
  KlineChartData,
  Signal,
  StrategyDecision,
  StrategyAPI,
  StrategyAPIExitParams,
  StrategyAPIMarketDataParams,
  StrategyAPIEntryParams,
  StrategyAPIProtectParams,
  StrategyEntrySignalContext,
  StrategyEntryOrderPlan,
  StrategyEntryRuntimeOptions,
  StrategyLastTradeControllerParams,
  StrategyMarketSnapshot,
  StrategyRuntimeAiOptions,
  StrategyRuntimeMlOptions,
} from '@tradejs/types';
import {
  calculateRiskRatio,
  getDirectionalTpSlPrices,
  getStrategyMarketSnapshot,
} from './market';
import { createLastTradeController } from './state';
import { uuid } from '../uuid';

type AiRuntimeConfigLike = {
  AI_ENABLED?: boolean;
  MIN_AI_QUALITY?: number;
  AI_REPLAY_ANALYSES?: StrategyRuntimeAiOptions['replayAnalyses'];
};

type MlRuntimeConfigLike = {
  ML_ENABLED?: boolean;
  ML_THRESHOLD?: number;
};

export const mapAiRuntimeFromConfig = <TConfig extends AiRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeAiOptions> = {},
): StrategyRuntimeAiOptions => ({
  enabled: Boolean(config.AI_ENABLED ?? true),
  minQuality: Number(config.MIN_AI_QUALITY ?? 4),
  replayAnalyses: config.AI_REPLAY_ANALYSES,
  ...overrides,
});

export const mapMlRuntimeFromConfig = <TConfig extends MlRuntimeConfigLike>(
  config: TConfig,
  overrides: Partial<StrategyRuntimeMlOptions> = {},
): StrategyRuntimeMlOptions => ({
  enabled: Boolean(config.ML_ENABLED ?? true),
  mlThreshold: Number(config.ML_THRESHOLD ?? 0),
  ...overrides,
});

export const buildStrategySignal = ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  prices,
  figures = {},
  indicators = {},
  additionalIndicators,
  isConfigFromBacktest,
}: BuildStrategySignalParams): Signal => ({
  signalId,
  strategy,
  symbol,
  interval,
  direction,
  timestamp,
  figures,
  prices,
  indicators,
  additionalIndicators,
  isConfigFromBacktest,
});

interface BuildEntrySignalDecisionParams {
  code: string;
  entryContext: StrategyEntrySignalContext;
  figures?: BuildStrategySignalDraft['figures'];
  indicators?: BuildStrategySignalDraft['indicators'];
  additionalIndicators?: BuildStrategySignalDraft['additionalIndicators'];
  signalId?: BuildStrategySignalDraft['signalId'];
  orderPlan: StrategyEntryOrderPlan;
  runtime?: StrategyEntryRuntimeOptions;
}

export const buildEntrySignalDecision = <
  TFigures extends
    BuildStrategySignalDraft['figures'] = BuildStrategySignalDraft['figures'],
  TIndicators extends
    BuildStrategySignalDraft['indicators'] = BuildStrategySignalDraft['indicators'],
  TAdditional extends
    BuildStrategySignalDraft['additionalIndicators'] = BuildStrategySignalDraft['additionalIndicators'],
>({
  code,
  entryContext,
  figures,
  indicators,
  additionalIndicators,
  signalId,
  orderPlan,
  runtime,
}: Omit<
  BuildEntrySignalDecisionParams,
  'figures' | 'indicators' | 'additionalIndicators'
> & {
  figures?: TFigures;
  indicators?: TIndicators;
  additionalIndicators?: TAdditional;
}): StrategyDecision => ({
  kind: 'entry',
  code,
  entryContext,
  signal: buildStrategySignal({
    signalId: signalId ?? uuid(),
    strategy: entryContext.strategy,
    symbol: entryContext.symbol,
    interval: entryContext.interval,
    direction: entryContext.direction,
    timestamp: entryContext.timestamp,
    prices: entryContext.prices,
    figures,
    indicators,
    additionalIndicators,
    isConfigFromBacktest: entryContext.isConfigFromBacktest,
  }),
  orderPlan,
  runtime,
});

interface CreateStrategyAPIParams {
  strategy: Signal['strategy'];
  symbol: Signal['symbol'];
  interval: Signal['interval'];
  env: string;
  connector: Connector;
  cachedData: KlineChartData;
  indicatorsState?: {
    next: (
      candle: KlineChartData[number],
      btcCandle: KlineChartData[number],
    ) => unknown;
  };
  preloadStart?: number;
  backtestPriceMode?: BacktestPriceMode;
  isConfigFromBacktest?: Signal['isConfigFromBacktest'];
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toDefaultEntryCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_ENTRY`;

const toDefaultExitCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_EXIT`;

const toDefaultProtectCode = (strategy: string, direction: Direction) =>
  `${strategy
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()}_${direction}_PROTECT`;

const resolveTakeProfitPrice = ({
  direction,
  takeProfits,
}: {
  direction: Direction;
  takeProfits: StrategyEntryOrderPlan['takeProfits'];
}): number => {
  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    throw new Error('strategyApi.entry requires at least one takeProfit');
  }

  const prices = takeProfits
    .map((tp) => tp?.price)
    .filter((price): price is number => isFiniteNumber(price));

  if (prices.length === 0) {
    throw new Error('strategyApi.entry requires finite takeProfit prices');
  }

  return direction === 'LONG' ? Math.max(...prices) : Math.min(...prices);
};

export const createStrategyAPI = ({
  strategy,
  symbol,
  interval,
  env,
  connector,
  cachedData,
  indicatorsState,
  preloadStart,
  backtestPriceMode,
  isConfigFromBacktest,
}: CreateStrategyAPIParams): StrategyAPI => {
  const getCurrentPosition = () => connector.getPosition(symbol);
  const isPositionExists = async () => {
    const position = await getCurrentPosition();
    return Boolean(
      position && typeof position.qty === 'number' && position.qty > 0,
    );
  };

  const getMarketData = async (
    params: StrategyAPIMarketDataParams = {},
  ): Promise<StrategyMarketSnapshot> => {
    const resolvedPreloadStart = params.preloadStart ?? preloadStart;

    if (typeof resolvedPreloadStart !== 'number') {
      throw new Error('strategyApi.getMarketData requires preloadStart');
    }

    const snapshot = await getStrategyMarketSnapshot({
      env,
      connector,
      symbol,
      interval,
      cachedData,
      preloadStart: resolvedPreloadStart,
      backtestPriceMode: params.backtestPriceMode ?? backtestPriceMode,
    });

    return snapshot;
  };

  return {
    skip: (code) => ({ kind: 'skip', code }),
    entry: async ({
      code,
      direction,
      figures,
      indicators,
      additionalIndicators,
      signalId,
      orderPlan,
      runtime,
    }: StrategyAPIEntryParams) => {
      const marketData = await getMarketData();
      const currentPrice = marketData.currentPrice;
      const timestamp = marketData.timestamp;
      const stopLossPrice = orderPlan.stopLossPrice;
      const takeProfitPrice = resolveTakeProfitPrice({
        direction,
        takeProfits: orderPlan.takeProfits,
      });

      if (!isFiniteNumber(stopLossPrice)) {
        throw new Error(
          'strategyApi.entry requires finite orderPlan.stopLossPrice',
        );
      }

      const resolvedCode =
        code ?? toDefaultEntryCode(String(strategy), direction);
      const riskRatio = calculateRiskRatio({
        direction,
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
      });

      return buildEntrySignalDecision({
        code: resolvedCode,
        entryContext: {
          strategy,
          symbol,
          interval,
          direction,
          timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio,
          },
          isConfigFromBacktest,
        },
        figures,
        indicators,
        additionalIndicators,
        signalId,
        orderPlan,
        runtime,
      }) as Extract<StrategyDecision, { kind: 'entry' }>;
    },
    exit: async ({
      code,
      direction,
      price,
      timestamp,
    }: StrategyAPIExitParams) => {
      const marketData = await getMarketData();
      return {
        kind: 'exit',
        code: code ?? toDefaultExitCode(String(strategy), direction),
        closePlan: {
          price: price ?? marketData.currentPrice,
          timestamp: timestamp ?? marketData.timestamp,
          direction,
        },
      } as Extract<StrategyDecision, { kind: 'exit' }>;
    },
    protect: ({ code, protectPlan }: StrategyAPIProtectParams) =>
      ({
        kind: 'protect',
        code:
          code ?? toDefaultProtectCode(String(strategy), protectPlan.direction),
        protectPlan,
      }) as Extract<StrategyDecision, { kind: 'protect' }>,
    getMarketData,
    nextIndicators: (candle, btcCandle) =>
      indicatorsState?.next(candle, btcCandle),
    getCurrentPosition,
    isCurrentPositionExists: isPositionExists,
    getDirectionalTpSlPrices: (params) => getDirectionalTpSlPrices(params),
    createLastTradeController: (params?: StrategyLastTradeControllerParams) =>
      createLastTradeController({
        env,
        ...params,
      }),
  };
};
