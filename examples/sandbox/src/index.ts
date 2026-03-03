import type {
  Candle,
  Signal,
  Strategy,
  StrategyConfig,
  StrategyCreator,
  StrategyManifest,
} from '@tradejs/framework';
import { defineStrategyPlugin } from '@tradejs/framework';

interface SandboxConfig extends StrategyConfig {
  INTERVAL?: Signal['interval'];
  SANDBOX_MIN_MOVE_PCT?: number;
  SANDBOX_TP_PCT?: number;
  SANDBOX_SL_PCT?: number;
}

const createSignal = (params: {
  strategy: string;
  symbol: string;
  interval: Signal['interval'];
  candle: Candle;
  direction: Signal['direction'];
  movePct: number;
  tpPct: number;
  slPct: number;
}): Signal => {
  const {
    strategy,
    symbol,
    interval,
    candle,
    direction,
    movePct,
    tpPct,
    slPct,
  } = params;

  const currentPrice = candle.close;
  const takeProfitPrice =
    direction === 'LONG'
      ? currentPrice * (1 + tpPct / 100)
      : currentPrice * (1 - tpPct / 100);
  const stopLossPrice =
    direction === 'LONG'
      ? currentPrice * (1 - slPct / 100)
      : currentPrice * (1 + slPct / 100);

  return {
    signalId: `sandbox-${symbol}-${candle.timestamp}`,
    symbol,
    interval,
    strategy,
    direction,
    timestamp: candle.timestamp,
    figures: {
      points: [
        {
          id: 'sandbox-entry',
          kind: 'entry',
          points: [{ timestamp: candle.timestamp, value: currentPrice }],
          color: direction === 'LONG' ? '#22c55e' : '#ef4444',
          radius: 3,
        },
      ],
    },
    prices: {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio: tpPct / slPct,
    },
    indicators: {
      sandboxMovePct: movePct,
    },
  };
};

const SandboxMomentumStrategyCreator: StrategyCreator = async ({
  symbol,
  data,
  config,
}) => {
  const strategyName = 'SandboxMomentum';
  const typedConfig = (config || {}) as SandboxConfig;
  const interval = typedConfig.INTERVAL || '15';
  const minMovePct = Number(typedConfig.SANDBOX_MIN_MOVE_PCT ?? 0.35);
  const tpPct = Number(typedConfig.SANDBOX_TP_PCT ?? 0.6);
  const slPct = Number(typedConfig.SANDBOX_SL_PCT ?? 0.3);

  const candles = [...data];

  const strategy: Strategy = async (candle) => {
    const prev = candles[candles.length - 1];
    candles.push(candle);

    if (!prev || prev.close === 0) {
      return 'SANDBOX_WAIT_PREV_CANDLE';
    }

    const movePct = ((candle.close - prev.close) / prev.close) * 100;
    if (Math.abs(movePct) < minMovePct) {
      return 'SANDBOX_NO_SIGNAL';
    }

    return createSignal({
      strategy: strategyName,
      symbol,
      interval,
      candle,
      direction: movePct > 0 ? 'LONG' : 'SHORT',
      movePct,
      tpPct,
      slPct,
    });
  };

  return strategy;
};

const sandboxManifest: StrategyManifest = {
  name: 'SandboxMomentum',
};

export const strategyEntries = defineStrategyPlugin({
  strategyEntries: [
    {
      manifest: sandboxManifest,
      creator: SandboxMomentumStrategyCreator,
    },
  ],
}).strategyEntries;

export default defineStrategyPlugin({ strategyEntries });
