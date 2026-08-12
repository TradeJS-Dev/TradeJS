/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createStructureZonesCore } from '../core';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

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

const HISTORY = [
  makeCandle(0, 100, 102, 98, 100),
  makeCandle(1, 101, 104, 99, 102),
  makeCandle(2, 102, 110, 100, 108),
  makeCandle(3, 108, 106, 101, 103),
  makeCandle(4, 103, 105, 96, 99),
  makeCandle(5, 99, 104, 94, 96),
  makeCandle(6, 96, 103, 95, 101),
  makeCandle(7, 101, 105, 97, 103),
];

const CANDIDATE = makeCandle(8, 95, 98, 94.5, 97);
const CONFIRMATION = makeCandle(9, 98, 98, 95.4, 97);

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    STRUCTURE_ZONES_PIVOT_LENGTH: 2,
    STRUCTURE_ZONES_ATR_LENGTH: 5,
    STRUCTURE_ZONES_MIN_SWING_ATR: 0.1,
    STRUCTURE_ZONES_ZONE_WIDTH_ATR: 0.2,
    STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR: 0.1,
    STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_LONG: undefined,
    STRUCTURE_ZONES_MIN_REACTION_DISTANCE_ATR_SHORT: undefined,
    STRUCTURE_ZONES_PENDING_CONFIRMATION_MAX_BARS: 3,
    STRUCTURE_ZONES_MAX_ATR_PCT_RANK100: 0,
    STRUCTURE_ZONES_MIN_REACTION_CLOSE_DISTANCE_PCT: 0,
    STRUCTURE_ZONES_MIN_REACTION_CLOSE_DISTANCE_PCT_LONG: 0,
    STRUCTURE_ZONES_MIN_REACTION_CLOSE_DISTANCE_PCT_SHORT: 0,
    STRUCTURE_ZONES_MIN_TREND_PERSISTENCE: 0,
    STRUCTURE_ZONES_MIN_TREND_PERSISTENCE_LONG: 0,
    STRUCTURE_ZONES_MIN_TREND_PERSISTENCE_SHORT: 0,
    STRUCTURE_ZONES_TRADE_TRANSITION_BREAKOUTS: false,
    STRUCTURE_ZONES_COOLDOWN_HOURS: 0,
    LONG: { ...DEFAULT_CONFIG.LONG, minRiskRatio: 0 },
    SHORT: { ...DEFAULT_CONFIG.SHORT, minRiskRatio: 0 },
    ...overrides,
  }) as any;

const makeStrategyApi = ({
  stateController,
  decision,
}: {
  stateController: ReturnType<typeof createTestStateController>;
  decision: { timestamp: number; currentPrice: number };
}) => ({
  skip: jest.fn((code: string) => ({ kind: 'skip', code })),
  entry: jest.fn(async (params: any) => ({ kind: 'entry', ...params })),
  exit: jest.fn(async (params: any) => ({ kind: 'exit', ...params })),
  getCurrentPosition: jest.fn(async () => null),
  getDecisionPriceContext: jest.fn(async () => decision),
  getBaseContext: jest.fn(() => ({})),
  createLastTradeController: jest.fn(() => ({
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
  })),
  createStateController: stateController,
});

const createCore = async ({
  config,
  initialData,
  stateController,
  decision,
}: {
  config: ReturnType<typeof makeConfig>;
  initialData: typeof HISTORY;
  stateController: ReturnType<typeof createTestStateController>;
  decision: { timestamp: number; currentPrice: number };
}) => {
  const strategyApi = makeStrategyApi({ stateController, decision });
  const core = await createStructureZonesCore({
    config,
    data: initialData as any,
    strategyApi: strategyApi as any,
    indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
  });
  return { core, strategyApi };
};

describe('StructureZones pending confirmation core lifecycle', () => {
  it('is idempotent, survives wrapper recreation, and isolates the full config', async () => {
    const stateController = createTestStateController();
    const decision = {
      timestamp: CANDIDATE.timestamp,
      currentPrice: CANDIDATE.close,
    };
    const config = makeConfig();
    const candidateWrapper = await createCore({
      config,
      initialData: HISTORY,
      stateController,
      decision,
    });

    const first = await candidateWrapper.core(CANDIDATE as any, {} as any);
    const duplicate = await candidateWrapper.core(CANDIDATE as any, {} as any);

    expect(first).toEqual({
      kind: 'skip',
      code: 'NO_STRUCTURE_ZONE_SIGNAL',
    });
    expect(duplicate).toEqual(first);
    expect(candidateWrapper.strategyApi.entry).not.toHaveBeenCalled();

    decision.timestamp = CONFIRMATION.timestamp;
    decision.currentPrice = CONFIRMATION.close;
    const isolatedWrapper = await createCore({
      config: makeConfig({ STRUCTURE_ZONES_TARGET_R_MULT_LONG: 1.1 }),
      initialData: [],
      stateController,
      decision,
    });
    expect(await isolatedWrapper.core(CONFIRMATION as any, {} as any)).toEqual({
      kind: 'skip',
      code: 'NO_STRUCTURE_ZONE_SIGNAL',
    });

    const recreatedWrapper = await createCore({
      config,
      initialData: [...HISTORY, CANDIDATE],
      stateController,
      decision,
    });
    const confirmed = (await recreatedWrapper.core(
      CONFIRMATION as any,
      {} as any,
    )) as any;

    expect(confirmed).toMatchObject({
      kind: 'entry',
      code: 'STRUCTURE_ZONES_SUPPORT_REACTION_LONG',
      direction: 'LONG',
      additionalIndicators: {
        structureZonesContext: {
          setupId: `support_reaction:${HISTORY[5].timestamp}`,
          candidateTimestamp: CANDIDATE.timestamp,
          confirmationTimestamp: CONFIRMATION.timestamp,
          confirmationAge: 1,
          confirmationMode: 'support_retest_hold',
          confirmationClose: CONFIRMATION.close,
          held: true,
        },
      },
    });
  });
});
