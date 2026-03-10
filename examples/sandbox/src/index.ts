import type {
  Candle,
  IndicatorPluginEntry,
  Signal,
  Strategy,
  StrategyConfig,
  StrategyCreator,
  StrategyManifest,
} from '@tradejs/core';
import { defineIndicatorPlugin, defineStrategyPlugin } from '@tradejs/core';

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

const indicatorEntries = defineIndicatorPlugin({
  indicatorEntries: [
    {
      indicator: {
        id: 'sandboxMomentum',
        label: 'Sandbox Momentum',
        enabled: false,
      },
      historyKey: 'sandboxMomentum',
      compute: ({ data }) => {
        const last = data[data.length - 1];
        const prev = data[data.length - 2];
        if (!last || !prev || prev.close === 0) {
          return null;
        }
        return ((last.close - prev.close) / prev.close) * 100;
      },
      renderer: {
        shortName: 'SBX MOM',
        minHeight: 120,
        figures: [
          {
            key: 'sandboxMomentum',
            title: 'Sandbox Momentum: ',
            type: 'line',
            color: '#f59e0b',
          },
          {
            key: 'sandboxMomentumZero',
            title: 'Zero: ',
            type: 'line',
            color: '#94a3b8',
            dashed: true,
            constant: 0,
          },
        ],
      },
    } satisfies IndicatorPluginEntry,
  ],
}).indicatorEntries;

export { indicatorEntries };

export default {
  strategyEntries,
  indicatorEntries,
};
