import { defineStrategyPlugin } from '@tradejs/core/config';
import {
  type Candle,
  type Signal,
  type Strategy,
  type StrategyConfig,
  type StrategyCreator,
  type StrategyManifest,
} from '@tradejs/types';

const STRATEGY_NAME = 'SandboxDeterministicSignal';

interface SandboxStrategyConfig extends StrategyConfig {
  INTERVAL?: Signal['interval'];
  SANDBOX_ENTRY_EVERY_BARS?: number;
  SANDBOX_QTY?: number;
  SANDBOX_TP_PCT?: number;
  SANDBOX_SL_PCT?: number;
}

const createSignal = (params: {
  strategy: string;
  symbol: string;
  interval: Signal['interval'];
  candle: Candle;
  movePct: number;
  tpPct: number;
  slPct: number;
}): Signal => {
  const { strategy, symbol, interval, candle, movePct, tpPct, slPct } = params;

  const currentPrice = candle.close;
  const takeProfitPrice = currentPrice * (1 + tpPct / 100);
  const stopLossPrice = currentPrice * (1 - slPct / 100);

  return {
    signalId: `sandbox-deterministic-${symbol}-${candle.timestamp}`,
    symbol,
    interval,
    strategy,
    direction: 'LONG',
    timestamp: candle.timestamp,
    figures: {
      points: [
        {
          id: 'sandbox-entry',
          kind: 'entry',
          points: [{ timestamp: candle.timestamp, value: currentPrice }],
          color: '#22c55e',
          radius: 3,
        },
      ],
    },
    prices: {
      currentPrice,
      takeProfitPrice,
      stopLossPrice,
      riskRatio: slPct > 0 ? tpPct / slPct : 0,
    },
    indicators: {
      sandboxMovePct: movePct,
      sandboxEntrySlot: true,
    },
  };
};

const SandboxDeterministicStrategyCreator: StrategyCreator = async ({
  symbol,
  data,
  config,
  connector,
}) => {
  const typedConfig = (config || {}) as SandboxStrategyConfig;
  const interval = typedConfig.INTERVAL || '15';
  const entryEveryBars = Math.max(
    1,
    Math.floor(Number(typedConfig.SANDBOX_ENTRY_EVERY_BARS ?? 96)),
  );
  const qty = Number(typedConfig.SANDBOX_QTY ?? 1);
  const tpPct = Number(typedConfig.SANDBOX_TP_PCT ?? 0.4);
  const slPct = Number(typedConfig.SANDBOX_SL_PCT ?? 1);

  const candles = [...data];

  const strategy: Strategy = async (candle) => {
    const previousCandle = candles[candles.length - 1];
    candles.push(candle);

    if (!previousCandle || previousCandle.close <= 0) {
      return 'SANDBOX_WAIT_PREV_CANDLE';
    }

    if (qty <= 0) {
      return 'SANDBOX_INVALID_QTY';
    }

    const inPosition = await connector.getPosition(symbol);
    if (inPosition) {
      return 'SANDBOX_POSITION_EXISTS';
    }

    if (candles.length % entryEveryBars !== 0) {
      return 'SANDBOX_WAIT_ENTRY_SLOT';
    }

    const movePct =
      ((candle.close - previousCandle.close) / previousCandle.close) * 100;

    const signal = createSignal({
      strategy: STRATEGY_NAME,
      symbol,
      interval,
      candle,
      movePct,
      tpPct,
      slPct,
    });

    const placed = await connector.placeOrder({
      symbol,
      qty,
      price: signal.prices.currentPrice,
      timestamp: candle.timestamp,
      direction: signal.direction,
      signal,
    });

    if (!placed) {
      return 'SANDBOX_ORDER_REJECTED';
    }

    const takeProfitsSet = await connector.setTakeProfits({
      symbol,
      direction: signal.direction,
      qty,
      takeProfits: [
        {
          price: signal.prices.takeProfitPrice,
          rate: 1,
        },
      ],
    });

    if (!takeProfitsSet) {
      await connector.closePosition({
        symbol,
        price: signal.prices.currentPrice,
        timestamp: candle.timestamp,
        direction: signal.direction,
      });
      return 'SANDBOX_SET_TP_FAILED';
    }

    const stopLossSet = await connector.setStopLoss({
      symbol,
      direction: signal.direction,
      stopLossPrice: signal.prices.stopLossPrice,
    });

    if (!stopLossSet) {
      await connector.closePosition({
        symbol,
        price: signal.prices.currentPrice,
        timestamp: candle.timestamp,
        direction: signal.direction,
      });
      return 'SANDBOX_SET_SL_FAILED';
    }

    return signal;
  };

  return strategy;
};

const sandboxManifest: StrategyManifest = {
  name: STRATEGY_NAME,
};

const strategyEntries = defineStrategyPlugin({
  strategyEntries: [
    {
      manifest: sandboxManifest,
      creator: SandboxDeterministicStrategyCreator,
    },
  ],
}).strategyEntries;

export { STRATEGY_NAME, strategyEntries, SandboxDeterministicStrategyCreator };

export default defineStrategyPlugin({ strategyEntries });
