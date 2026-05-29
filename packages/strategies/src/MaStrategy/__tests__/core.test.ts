/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createMaStrategyCore } from '../core';

const makeCandle = (index: number, price: number) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open: price,
  high: price + 1,
  low: price - 1,
  close: price,
  volume: 1_000,
  turnover: price * 1_000,
});

const makeIndicatorsState = (snapshot: Record<string, unknown> | null) =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => snapshot),
    latestNumber: jest.fn(() => undefined),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeStrategyApi = ({
  marketData,
  currentPosition = null,
  riskRatio = 2,
  qty = 3,
}: {
  marketData: any;
  currentPosition?: any;
  riskRatio?: number;
  qty?: number;
}) => {
  const lastTradeController = {
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
    getLastTradeTimestamp: jest.fn(() => null),
  };

  const strategyApi = {
    skip: jest.fn((code: string) => ({ kind: 'skip', code })),
    getMarketData: jest.fn(async () => marketData),
    getCurrentPosition: jest.fn(async () => currentPosition),
    createLastTradeController: jest.fn(() => lastTradeController),
    getDirectionalTpSlPrices: jest.fn(() => ({
      stopLossPrice: 98,
      takeProfitPrice: 104,
      riskRatio,
      qty,
    })),
    entry: jest.fn(async (params: any) => ({
      kind: 'entry',
      code: params.code,
      direction: params.direction,
      figures: params.figures,
      indicators: params.indicators,
      additionalIndicators: params.additionalIndicators,
      orderPlan: params.orderPlan,
    })),
  } as any;

  return { strategyApi, lastTradeController };
};

const makeCore = async ({
  indicators,
  strategyApi,
}: {
  indicators: Record<string, unknown> | null;
  strategyApi: any;
}) =>
  createMaStrategyCore({
    userName: 'root',
    symbol: 'TESTUSDT',
    config: DEFAULT_CONFIG as any,
    isConfigFromBacktest: false,
    connector: {} as any,
    data: [],
    btcData: [],
    loadPineScriptFile: jest.fn(),
    strategyApi,
    indicatorsState: makeIndicatorsState(indicators),
  });

describe('MaStrategy core', () => {
  it('skips when fast and slow moving averages do not cross', async () => {
    const candles = [makeCandle(0, 100), makeCandle(1, 101)];
    const { strategyApi } = makeStrategyApi({
      marketData: {
        fullData: candles,
        timestamp: candles[1].timestamp,
        currentPrice: candles[1].close,
      },
    });
    const core = await makeCore({
      strategyApi,
      indicators: {
        maFast: [100, 101],
        maSlow: [98, 99],
      },
    });

    const result = await core(candles[1] as any, candles[1] as any);

    expect(result).toEqual({ kind: 'skip', code: 'NO_CROSS' });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('creates a long entry with figures on bullish MA cross', async () => {
    const candles = [makeCandle(0, 100), makeCandle(1, 103)];
    const { strategyApi, lastTradeController } = makeStrategyApi({
      marketData: {
        fullData: candles,
        timestamp: candles[1].timestamp,
        currentPrice: candles[1].close,
      },
    });
    const core = await makeCore({
      strategyApi,
      indicators: {
        maFast: [99, 102],
        maSlow: [100, 101],
      },
    });

    const result = await core(candles[1] as any, candles[1] as any);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'MA_BULLISH_CROSS',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'MA_BULLISH_CROSS',
        direction: 'LONG',
        orderPlan: {
          qty: 3,
          stopLossPrice: 98,
          takeProfits: [{ rate: 1, price: 104 }],
        },
        additionalIndicators: expect.objectContaining({
          crossKind: 'bullish',
          maGap: 1,
        }),
      }),
    );
    expect((result as any).figures.lines).toHaveLength(2);
    expect((result as any).figures.points).toHaveLength(1);
    expect(lastTradeController.markTrade).toHaveBeenCalledWith(
      candles[1].timestamp,
    );
  });

  it('exits an existing long position on bearish MA cross', async () => {
    const candles = [makeCandle(0, 100), makeCandle(1, 98)];
    const { strategyApi } = makeStrategyApi({
      marketData: {
        fullData: candles,
        timestamp: candles[1].timestamp,
        currentPrice: candles[1].close,
      },
      currentPosition: {
        direction: 'LONG',
        qty: 1,
      },
    });
    const core = await makeCore({
      strategyApi,
      indicators: {
        maFast: [102, 99],
        maSlow: [101, 100],
      },
    });

    const result = await core(candles[1] as any, candles[1] as any);

    expect(result).toEqual({
      kind: 'exit',
      code: 'CLOSE_BY_OPPOSITE_MA_CROSS',
      closePlan: {
        price: candles[1].close,
        timestamp: candles[1].timestamp,
        direction: 'LONG',
      },
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });
});
