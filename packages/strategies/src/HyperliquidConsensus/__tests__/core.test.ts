import type {
  BaseHyperliquidWhaleFlowContext,
  BaseStrategyContextSnapshot,
} from '@tradejs/types';
import { config } from '../config';
import { createHyperliquidConsensusCore } from '../core';

const timestamp = 1_700_000_000_000;
const candle = {
  timestamp,
  open: 99,
  high: 102,
  low: 98,
  close: 100,
  volume: 1_000,
  turnover: 100_000,
};

const makeFlow = (
  overrides: Partial<BaseHyperliquidWhaleFlowContext> = {},
): BaseHyperliquidWhaleFlowContext => ({
  source: 'hyperliquid_trades',
  interval: '5m',
  asOfTs: timestamp + 240_000,
  windowEndTs: timestamp + 300_000,
  ageMs: 0,
  stale: false,
  symbol: 'BTC',
  trades: 8,
  whaleSides: 8,
  uniqueWhales: 4,
  coveredWhales: 90,
  expectedWhales: 100,
  coveragePct: 0.9,
  coverageSufficient: true,
  buyNotionalUsd: 180_000,
  sellNotionalUsd: 60_000,
  netNotionalUsd: 120_000,
  buySharePct: 0.75,
  positionAwareWhaleSides: 8,
  positionAwarePct: 1,
  longEntryWhales: 4,
  shortEntryWhales: 1,
  longExitWhales: 1,
  shortExitWhales: 0,
  longEntryNotionalUsd: 180_000,
  shortEntryNotionalUsd: 60_000,
  longExitNotionalUsd: 20_000,
  shortExitNotionalUsd: 0,
  entryNetNotionalUsd: 120_000,
  entryLongSharePct: 0.75,
  universeFingerprint: 'universe',
  whaleRegistryFingerprint: 'wallets',
  ...overrides,
});

const makeBaseContext = (
  flow: BaseHyperliquidWhaleFlowContext | null = makeFlow(),
) =>
  ({
    candle,
    prevCandle: null,
    raw: { volatility: { atr: 1 } },
    regime: {},
    structure: {},
    participation: {
      volume: {
        volumeRel20: null,
        turnoverRel20: null,
        volumeTrendSlope: null,
        obvSlope: null,
        effortVsResult: null,
      },
      ...(flow ? { hyperliquidWhales: flow } : {}),
    },
    relative: {},
    mtf: {},
  }) as BaseStrategyContextSnapshot;

const makeStrategyApi = ({
  baseContext = makeBaseContext(),
  position = null,
}: {
  baseContext?: BaseStrategyContextSnapshot | undefined;
  position?: any;
} = {}) => {
  const lastTradeController = {
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
    getLastTradeTimestamp: jest.fn(() => null),
  };
  const strategyApi = {
    skip: jest.fn((code: string) => ({ kind: 'skip', code })),
    entry: jest.fn(async (params: any) => ({ kind: 'entry', ...params })),
    exit: jest.fn(async (params: any) => ({ kind: 'exit', ...params })),
    protect: jest.fn(),
    getCurrentIndicatorsContext: jest.fn(() => ({
      indicators: { atr: [1] },
      baseContext,
    })),
    getBaseContext: jest.fn(() => baseContext),
    getDecisionBaseContext: jest.fn(async () => baseContext),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp,
      currentPrice: 100,
      candle,
    })),
    getCurrentPosition: jest.fn(async () => position),
    getDirectionalTpSlPrices: jest.fn(),
    createLastTradeController: jest.fn(() => lastTradeController),
    createStateController: jest.fn(),
  } as any;
  return { strategyApi, lastTradeController };
};

const createCore = async (strategyApi: any, overrides = {}) =>
  createHyperliquidConsensusCore({
    userName: 'root',
    symbol: 'BTCUSDT',
    config: { ...config, ...overrides } as any,
    isConfigFromBacktest: true,
    connector: {} as any,
    data: [candle] as any,
    btcData: [candle] as any,
    loadPineScriptFile: jest.fn(),
    strategyApi,
    indicatorsState: {} as any,
  });

describe('createHyperliquidConsensusCore', () => {
  it('creates a risk-sized LONG entry with causal consensus evidence', async () => {
    const { strategyApi, lastTradeController } = makeStrategyApi();
    const core = await createCore(strategyApi);

    const decision = await core(candle as any, candle as any);

    expect(decision).toMatchObject({
      kind: 'entry',
      code: 'HLC_LONG_CONSENSUS',
      direction: 'LONG',
      additionalIndicators: {
        hyperliquidConsensusContext: {
          signalDirection: 'LONG',
          entryWhales: 4,
          consensusScore: 0.5,
        },
      },
      orderPlan: {
        qty: expect.any(Number),
        stopLossPrice: 98.2,
        takeProfits: [{ rate: 1, price: expect.any(Number) }],
      },
    });
    expect((decision as any).figures.annotations[0].kind).toBe(
      'hyperliquid_consensus_entry_evidence',
    );
    expect(lastTradeController.markTrade).toHaveBeenCalledWith(timestamp);
    expect(strategyApi.getCurrentIndicatorsContext).toHaveBeenCalledTimes(1);
  });

  it('exits a LONG when fresh consensus reverses to SHORT', async () => {
    const baseContext = makeBaseContext(
      makeFlow({
        longEntryNotionalUsd: 50_000,
        shortEntryNotionalUsd: 200_000,
        entryNetNotionalUsd: -150_000,
        entryLongSharePct: 0.2,
        shortEntryWhales: 4,
      }),
    );
    const { strategyApi } = makeStrategyApi({
      baseContext,
      position: { direction: 'LONG', price: 100, qty: 1 },
    });
    const core = await createCore(strategyApi);

    await expect(core(candle as any, candle as any)).resolves.toMatchObject({
      kind: 'exit',
      code: 'HLC_OPPOSITE_CONSENSUS_EXIT',
      direction: 'LONG',
    });
  });

  it('exits a LONG when several whales reduce or close longs', async () => {
    const baseContext = makeBaseContext(
      makeFlow({
        longExitWhales: 4,
        shortExitWhales: 1,
        longExitNotionalUsd: 120_000,
        shortExitNotionalUsd: 20_000,
      }),
    );
    const { strategyApi } = makeStrategyApi({
      baseContext,
      position: { direction: 'LONG', price: 100, qty: 1 },
    });
    const core = await createCore(strategyApi);

    await expect(core(candle as any, candle as any)).resolves.toMatchObject({
      kind: 'exit',
      code: 'HLC_POSITION_REDUCTION_EXIT',
      direction: 'LONG',
    });
  });

  it('skips without a pre-decision Hyperliquid context', async () => {
    const { strategyApi } = makeStrategyApi({
      baseContext: makeBaseContext(null),
    });
    const core = await createCore(strategyApi);

    await expect(core(candle as any, candle as any)).resolves.toEqual({
      kind: 'skip',
      code: 'HLC_NO_CONTEXT',
    });
    expect(strategyApi.getCurrentIndicatorsContext).not.toHaveBeenCalled();
  });

  it('honors side enablement', async () => {
    const { strategyApi } = makeStrategyApi();
    const core = await createCore(strategyApi, {
      LONG: { ...config.LONG, enable: false },
    });

    await expect(core(candle as any, candle as any)).resolves.toEqual({
      kind: 'skip',
      code: 'STRATEGY_DISABLED',
    });
  });
});
