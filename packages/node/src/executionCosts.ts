import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  BACKTEST_DELAY_RISK_MULTIPLIER,
  BACKTEST_MARKET_IMPACT_BPS,
  BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
  FEE_PERCENT,
} from '@tradejs/core/constants';
import type {
  BacktestExecutionCosts,
  Connector,
  ExecutionCostModel,
  FundingRatePoint,
  InstrumentDescriptor,
  StrategyConfig,
} from '@tradejs/types';
import {
  assertStrategyExecutionIsolation,
  parseBacktestExecutionCosts,
} from '@tradejs/core/backtest';

const finiteOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const feeCache = new WeakMap<
  Connector,
  Map<string, Awaited<ReturnType<NonNullable<Connector['getTradingFeeRate']>>>>
>();
const fundingCache = new WeakMap<
  Connector,
  Map<string, Promise<FundingRatePoint[]>>
>();

const loadTradingFee = async (connector: Connector, symbol: string) => {
  if (!connector.getTradingFeeRate) return null;
  let cache = feeCache.get(connector);
  if (!cache) {
    cache = new Map();
    feeCache.set(connector, cache);
  }
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const rate = await connector.getTradingFeeRate(symbol);
  cache.set(key, rate);
  return rate;
};

const loadFundingRates = (
  connector: Connector,
  symbol: string,
  startTime: number,
  endTime: number,
) => {
  if (!connector.getFundingRateHistory) return Promise.resolve([]);
  let cache = fundingCache.get(connector);
  if (!cache) {
    cache = new Map();
    fundingCache.set(connector, cache);
  }
  const key = `${symbol.toUpperCase()}:${startTime}:${endTime}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = connector
    .getFundingRateHistory({ symbol, startTime, endTime })
    .catch(() => []);
  cache.set(key, pending);
  return pending;
};

export const resolveExecutionCosts = async (params: {
  connector: Connector;
  symbol: string;
  config: StrategyConfig;
  executionCosts?: BacktestExecutionCosts;
  cacheOnly?: boolean;
  startTime: number;
  endTime: number;
  instrument?: InstrumentDescriptor;
}): Promise<{
  model: ExecutionCostModel;
  fundingRates: FundingRatePoint[];
}> => {
  const { connector, symbol, config, startTime, endTime, instrument } = params;
  assertStrategyExecutionIsolation(config);
  const costs =
    params.executionCosts == null
      ? undefined
      : parseBacktestExecutionCosts(params.executionCosts);
  const cacheOnly = params.cacheOnly === true;
  const hasConfiguredFees = costs != null;
  const exchangeFees =
    !cacheOnly && !hasConfiguredFees && connector.getTradingFeeRate
      ? await loadTradingFee(connector, symbol).catch(() => null)
      : null;
  const makerRate = hasConfiguredFees
    ? costs.fees.makerRate
    : exchangeFees?.makerRate ?? FEE_PERCENT;
  const takerRate = hasConfiguredFees
    ? costs.fees.takerRate
    : exchangeFees?.takerRate ?? FEE_PERCENT;
  const fundingEnabled =
    costs?.funding.enabled !== false &&
    !cacheOnly &&
    typeof connector.getFundingRateHistory === 'function';
  const fundingRates = fundingEnabled
    ? await loadFundingRates(connector, symbol, startTime, endTime)
    : [];
  const requestedLeverage = Math.max(1, finiteOr(config.LEVERAGE, 10));
  const venueMaxLeverage = Number(instrument?.venueMetadata?.maxLeverage);
  const maxAllowed = Number.isFinite(venueMaxLeverage)
    ? venueMaxLeverage
    : null;
  const effectiveLeverage =
    maxAllowed == null
      ? requestedLeverage
      : Math.min(requestedLeverage, maxAllowed);
  const feeSource = hasConfiguredFees
    ? 'config'
    : exchangeFees?.source ?? 'fallback';
  const fundingSource = !fundingEnabled
    ? costs?.funding.enabled === false
      ? 'disabled'
      : cacheOnly
        ? 'fallback'
        : 'disabled'
    : fundingRates.length
      ? 'historical'
      : 'unavailable';
  const usesFallback =
    feeSource === 'fallback' ||
    (fundingEnabled && fundingSource === 'unavailable') ||
    !costs;
  if (
    costs?.funding.enabled &&
    (!fundingEnabled || fundingSource !== 'historical')
  ) {
    throw new Error(
      'Requested funding history is unavailable; explicitly disable funding or provide historical data',
    );
  }

  return {
    model: {
      fees: { makerRate, takerRate, source: feeSource },
      funding: {
        enabled: fundingEnabled,
        source: fundingSource,
        points: fundingRates.length,
        fromTimestamp: fundingRates[0]?.timestamp ?? null,
        toTimestamp: fundingRates.at(-1)?.timestamp ?? null,
      },
      slippage: {
        baseBps: costs?.slippage.baseBps ?? BACKTEST_BASE_SLIPPAGE_BPS,
        spreadMultiplier: finiteOr(
          costs?.slippage.spreadMultiplier,
          BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
        ),
        marketImpactBps: finiteOr(
          costs?.slippage.marketImpactBps,
          BACKTEST_MARKET_IMPACT_BPS,
        ),
        delayRiskMultiplier: finiteOr(
          costs?.slippage.delayRiskMultiplier,
          BACKTEST_DELAY_RISK_MULTIPLIER,
        ),
        source: costs != null ? 'config' : 'fallback',
      },
      leverage: {
        requested: requestedLeverage,
        effective: effectiveLeverage,
        maxAllowed,
      },
      quality: usesFallback
        ? 'fallback'
        : fundingEnabled && fundingRates.length
          ? 'full'
          : 'partial',
      capturedAt: Date.now(),
    },
    fundingRates,
  };
};
