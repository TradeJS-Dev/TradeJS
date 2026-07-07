/** @jest-environment node */

import { createStrategyAPI } from '@tradejs/core/strategies';
import { config as DEFAULT_CONFIG } from '../config';
import { createLiquidityZonesCore } from '../core';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000 + index * 100,
  turnover: close * (1_000 + index * 100),
});

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({
      baseContext: {},
    })),
    latestNumber: jest.fn(() => undefined),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeCore = async () => {
  const candles = [
    makeCandle(0, 102, 105, 100, 103),
    makeCandle(1, 100, 102, 90, 101),
    makeCandle(2, 99, 105, 99, 104),
  ];
  const initialCandles = candles.slice(0, -1);
  const runtimeData = [...initialCandles];
  const connector = {
    kline: jest.fn(),
    getPosition: jest.fn(async () => null),
  } as any;
  const strategyApi = createStrategyAPI({
    strategy: 'LiquidityZones' as any,
    symbol: 'TESTUSDT',
    interval: '15' as any,
    env: 'PARITY',
    connector,
    cachedData: runtimeData as any,
    preloadStart: 1,
    backtestPriceMode: 'close',
    isConfigFromBacktest: false,
  });
  const core = await createLiquidityZonesCore({
    userName: 'root',
    symbol: 'TESTUSDT',
    config: {
      ...DEFAULT_CONFIG,
      LIQUIDITY_ZONES_PIVOT_LOOKBACK: 1,
      LIQUIDITY_ZONES_MIN_FILTER_VALUE: 0,
    } as any,
    isConfigFromBacktest: false,
    connector,
    data: initialCandles as any,
    btcData: initialCandles as any,
    loadPineScriptFile: jest.fn(),
    strategyApi,
    indicatorsState: makeIndicatorsState(),
  });

  return { candles, core, runtimeData };
};

describe('LiquidityZones core', () => {
  it('reuses detector output when the same timestamp is evaluated twice', async () => {
    const { candles, core, runtimeData } = await makeCore();
    const currentCandle = candles[candles.length - 1];
    runtimeData.push(currentCandle);

    const first = await core(currentCandle as any, currentCandle as any);
    const second = await core(currentCandle as any, currentCandle as any);

    expect(first.kind).toBe('entry');
    expect(second.kind).toBe('entry');
    expect((first as any).code).toBe('LIQUIDITY_ZONES_SWING_LOW_RETEST');
    expect((second as any).code).toBe('LIQUIDITY_ZONES_SWING_LOW_RETEST');
  });

  it('rejects non-monotonic detector timestamps through the state controller', async () => {
    const { candles, core, runtimeData } = await makeCore();
    const currentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    runtimeData.push(currentCandle);

    await core(currentCandle as any, currentCandle as any);

    await expect(
      core(previousCandle as any, previousCandle as any),
    ).rejects.toThrow(/non-monotonic timestamp/);
  });
});
