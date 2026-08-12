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

const makeLastTradeControllerFactory = () => {
  let lastTradeTimestamp: number | null = null;

  return jest.fn(
    ({ enabled, cooldownMs }: { enabled: boolean; cooldownMs: number }) => ({
      isInCooldown: (currentTimestamp: number) =>
        Boolean(
          enabled &&
            lastTradeTimestamp != null &&
            currentTimestamp <= lastTradeTimestamp + cooldownMs,
        ),
      markTrade: (currentTimestamp: number) => {
        if (enabled) lastTradeTimestamp = currentTimestamp;
      },
      getLastTradeTimestamp: () => lastTradeTimestamp,
    }),
  );
};

const makeStrategyApi = ({
  baseContext = makeBaseContext(),
  position = null,
  decisionTimestamp = timestamp,
  lastTradeControllerFactory = makeLastTradeControllerFactory(),
}: {
  baseContext?: BaseStrategyContextSnapshot | undefined;
  position?: any;
  decisionTimestamp?: number;
  lastTradeControllerFactory?: ReturnType<
    typeof makeLastTradeControllerFactory
  >;
} = {}) => {
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
      timestamp: decisionTimestamp,
      currentPrice: 100,
      candle: { ...candle, timestamp: decisionTimestamp },
    })),
    getCurrentPosition: jest.fn(async () => position),
    getDirectionalTpSlPrices: jest.fn(),
    createLastTradeController: lastTradeControllerFactory,
    createStateController: jest.fn(),
  } as any;
  return { strategyApi, lastTradeControllerFactory };
};

const createCore = async (strategyApi: any, overrides = {}) =>
  createHyperliquidConsensusCore({
    config: { ...config, ...overrides } as any,
    data: [candle] as any,
    strategyApi,
    indicatorsState: {} as any,
  });

describe('createHyperliquidConsensusCore', () => {
  it('creates a risk-sized LONG entry with causal consensus evidence', async () => {
    const { strategyApi, lastTradeControllerFactory } = makeStrategyApi();
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
    expect(lastTradeControllerFactory).toHaveBeenCalledWith({
      enabled: true,
      cooldownMs: config.HLC_ENTRY_COOLDOWN_MS,
    });
    expect(
      lastTradeControllerFactory.mock.results[0]?.value.getLastTradeTimestamp(),
    ).toBe(timestamp);
    expect(strategyApi.getCurrentIndicatorsContext).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact cooldown boundary across repeated core wrappers', async () => {
    const lastTradeControllerFactory = makeLastTradeControllerFactory();
    const firstApi = makeStrategyApi({
      lastTradeControllerFactory,
    }).strategyApi;
    const firstCore = await createCore(firstApi);

    await expect(
      firstCore(candle as any, candle as any),
    ).resolves.toMatchObject({ kind: 'entry' });

    const boundaryTimestamp = timestamp + config.HLC_ENTRY_COOLDOWN_MS;
    const boundaryApi = makeStrategyApi({
      decisionTimestamp: boundaryTimestamp,
      lastTradeControllerFactory,
    }).strategyApi;
    const boundaryCore = await createCore(boundaryApi);

    await expect(boundaryCore(candle as any, candle as any)).resolves.toEqual({
      kind: 'skip',
      code: 'DEV_TRADE_COOLDOWN',
    });
    expect(boundaryApi.entry).not.toHaveBeenCalled();
  });

  it('allows a repeated core wrapper immediately after the cooldown boundary', async () => {
    const lastTradeControllerFactory = makeLastTradeControllerFactory();
    const firstApi = makeStrategyApi({
      lastTradeControllerFactory,
    }).strategyApi;
    const firstCore = await createCore(firstApi);
    await firstCore(candle as any, candle as any);

    const postBoundaryTimestamp = timestamp + config.HLC_ENTRY_COOLDOWN_MS + 1;
    const postBoundaryApi = makeStrategyApi({
      decisionTimestamp: postBoundaryTimestamp,
      lastTradeControllerFactory,
    }).strategyApi;
    const postBoundaryCore = await createCore(postBoundaryApi);

    await expect(
      postBoundaryCore(candle as any, candle as any),
    ).resolves.toMatchObject({ kind: 'entry' });
    expect(
      lastTradeControllerFactory.mock.results[1]?.value.getLastTradeTimestamp(),
    ).toBe(postBoundaryTimestamp);
  });

  it('does not mark cooldown state when the entry risk plan is invalid', async () => {
    const { strategyApi, lastTradeControllerFactory } = makeStrategyApi();
    const core = await createCore(strategyApi, {
      HLC_STOP_ATR_MULT: 0,
      HLC_STOP_BUFFER_PCT: 0,
    });

    await expect(core(candle as any, candle as any)).resolves.toEqual({
      kind: 'skip',
      code: 'INVALID_STOP',
    });
    expect(
      lastTradeControllerFactory.mock.results[0]?.value.getLastTradeTimestamp(),
    ).toBeNull();
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
