import { createStrategyAPI } from '@tradejs/core/strategies';
import type { Connector, KlineChartItem } from '@tradejs/types';
import { resolveExecutionCosts } from '../../executionCosts';
import { executeEntryOrder } from '../../strategyHelpers/runtime';
import { createTestConnector } from '../../testConnector';
import { applyBacktestDelayedEntryExecution } from '../runtimeBacktestDelay';
import { handleProtectDecision } from '../runtimeExecution';

const bar = (
  timestamp: number,
  open: number,
  high = open,
  low = open,
): KlineChartItem => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  high,
  low,
  close: open,
  volume: 1,
  turnover: open,
});

const executionCosts = {
  fees: { makerRate: 0.0002, takerRate: 0.00055 },
  slippage: {
    baseBps: 2,
    spreadMultiplier: 0,
    marketImpactBps: 0,
    delayRiskMultiplier: 0,
  },
  funding: { enabled: false },
};

it.each(['LONG', 'SHORT'] as const)(
  'places only a fill-relative stop for %s and applies a tighter stop to a later candle',
  async (direction) => {
    const sourceConnector = {} as Connector;
    const { model } = await resolveExecutionCosts({
      connector: sourceConnector,
      symbol: 'BTCUSDT',
      startTime: 0,
      endTime: 3_600_000,
      config: {},
      executionCosts,
      cacheOnly: true,
    });
    const connector = createTestConnector(sourceConnector, {
      executionCostModel: model,
    });
    const signalCandle = bar(0, 100);
    const side = direction === 'LONG' ? 1 : -1;
    const api = createStrategyAPI({
      strategy: 'ImbalanceMomentum',
      symbol: 'BTCUSDT',
      interval: '15',
      env: 'BACKTEST',
      connector,
      cachedData: [signalCandle],
    });
    const decision = await api.entry({
      direction,
      orderPlan: {
        qty: 1,
        takeProfits: [],
        stopLossPrice: 100 - side * 10,
        stopLossDistance: 10,
      },
    });
    const entryBar = bar(900_000, 100 - side * 12);
    const execution = applyBacktestDelayedEntryExecution({
      decision,
      execution: {
        candle: entryBar,
        btcCandle: entryBar,
        source: 'primary_timeframe',
      },
      backtestPriceMode: 'open',
      delayBars: 1,
    });
    expect(execution.skipReason).toBeNull();
    expect(await connector.getPosition('BTCUSDT')).toBeNull();
    expect(decision.entryContext.timestamp).toBe(entryBar.timestamp);
    expect(decision.signal).toBeDefined();
    const signal = decision.signal!;
    const fill = await executeEntryOrder({
      connector,
      symbol: 'BTCUSDT',
      direction,
      qty: 1,
      currentPrice: decision.entryContext.prices.currentPrice,
      timestamp: decision.entryContext.timestamp,
      stopLossPrice: decision.orderPlan.stopLossPrice,
      stopLossDistance: decision.orderPlan.stopLossDistance,
      takeProfits: decision.orderPlan.takeProfits,
      executionLimits: { feeRate: 0, slippageBps: 0, maxLossValue: 10 },
      recordRuntimeTrade: false,
      signal,
    });
    expect(fill).toBeCloseTo(entryBar.open * (1 + side * 0.0002), 8);
    expect(signal.prices.stopLossPrice).toBeCloseTo(fill - side * 10, 8);
    const position = await connector.getPosition('BTCUSDT');
    expect(position?.slPrice).toBeCloseTo(fill - side * 10, 8);
    expect(position?.tpPrice).toBeUndefined();

    const activation = bar(
      1_800_000,
      fill,
      fill + (side === 1 ? 31 : 5),
      fill - (side === 1 ? 5 : 31),
    );
    await connector.checkExits(activation);
    const tightened = fill + side * 21;
    await handleProtectDecision({
      connector,
      symbol: 'BTCUSDT',
      decision: api.protect({
        protectPlan: { direction, stopLossPrice: tightened },
      }),
      market: { candle: activation, btcCandle: activation },
    });
    expect((await connector.getPosition('BTCUSDT'))?.slPrice).toBe(tightened);

    await connector.checkExits(bar(2_700_000, tightened));
    expect(await connector.getPosition('BTCUSDT')).toBeNull();
  },
);
