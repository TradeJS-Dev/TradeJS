import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  BACKTEST_DELAY_RISK_MULTIPLIER,
  BACKTEST_MARKET_IMPACT_BPS,
  BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
  FEE_PERCENT,
} from '@tradejs/core/constants';
import type {
  Connector,
  ExecutionCostModel,
  FundingRatePoint,
  InstrumentDescriptor,
  StrategyConfig,
} from '@tradejs/types';

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
  startTime: number;
  endTime: number;
  instrument?: InstrumentDescriptor;
}): Promise<{
  model: ExecutionCostModel;
  fundingRates: FundingRatePoint[];
}> => {
  const { connector, symbol, config, startTime, endTime, instrument } = params;
  const cacheOnly = config.EXECUTION_COSTS_CACHE_ONLY === true;
  const hasConfiguredFees =
    Number.isFinite(Number(config.MAKER_FEE_RATE)) &&
    Number.isFinite(Number(config.TAKER_FEE_RATE));
  const exchangeFees =
    !cacheOnly && !hasConfiguredFees && connector.getTradingFeeRate
      ? await loadTradingFee(connector, symbol).catch(() => null)
      : null;
  const makerRate = hasConfiguredFees
    ? Number(config.MAKER_FEE_RATE)
    : exchangeFees?.makerRate ?? FEE_PERCENT;
  const takerRate = hasConfiguredFees
    ? Number(config.TAKER_FEE_RATE)
    : exchangeFees?.takerRate ?? FEE_PERCENT;
  const fundingEnabled =
    config.FUNDING_ENABLED !== false &&
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
    ? cacheOnly
      ? 'fallback'
      : 'disabled'
    : fundingRates.length
      ? 'historical'
      : 'unavailable';
  const usesFallback =
    feeSource === 'fallback' ||
    (fundingEnabled && fundingSource === 'unavailable') ||
    (config.SLIPPAGE_BASE_BPS == null &&
      config.SLIPPAGE_SPREAD_MULTIPLIER == null &&
      config.SLIPPAGE_MARKET_IMPACT_BPS == null);

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
        baseBps: finiteOr(config.SLIPPAGE_BASE_BPS, BACKTEST_BASE_SLIPPAGE_BPS),
        spreadMultiplier: finiteOr(
          config.SLIPPAGE_SPREAD_MULTIPLIER,
          BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
        ),
        marketImpactBps: finiteOr(
          config.SLIPPAGE_MARKET_IMPACT_BPS,
          BACKTEST_MARKET_IMPACT_BPS,
        ),
        delayRiskMultiplier: finiteOr(
          config.SLIPPAGE_DELAY_RISK_MULTIPLIER,
          BACKTEST_DELAY_RISK_MULTIPLIER,
        ),
        source:
          config.SLIPPAGE_BASE_BPS != null ||
          config.SLIPPAGE_SPREAD_MULTIPLIER != null ||
          config.SLIPPAGE_MARKET_IMPACT_BPS != null
            ? 'config'
            : 'fallback',
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
