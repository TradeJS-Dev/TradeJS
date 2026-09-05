import {
  loadBacktestCheckpointResults,
  loadBacktestRunManifest,
} from '../../backtest/checkpoint';
import { summarizeCoreResearchTrades } from '../metrics';
import { reconcileCoreResearchVariant } from '../reconciliation';
import { makeSpec, makeTrade, makeVariant } from '../__fixtures__/fixtures';

jest.mock('../../backtest/checkpoint', () => ({
  loadBacktestCheckpointResults: jest.fn(),
  loadBacktestRunManifest: jest.fn(),
}));

const mockedManifest = jest.mocked(loadBacktestRunManifest);
const mockedCompleted = jest.mocked(loadBacktestCheckpointResults);

const checkpoint = (params: {
  symbol: string;
  configId?: string;
  config?: Record<string, unknown>;
  orders?: number;
  wins?: number;
  losses?: number;
  pnl?: number;
}) =>
  ({
    status: 'success',
    testKey: params.symbol,
    updatedAt: '2026-01-01T00:00:00.000Z',
    result: {
      executionCostModel: {
        fees: { ...makeSpec().execution.costs.fees, source: 'config' },
        slippage: { ...makeSpec().execution.costs.slippage, source: 'config' },
        funding: { enabled: false, source: 'disabled' },
        leverage: { requested: 10, effective: 10, maxAllowed: null },
        quality: 'partial',
        capturedAt: 1,
      },
      test: {
        symbol: params.symbol,
        strategyName: 'FixtureStrategy',
        configId: params.configId ?? 'candidate-config',
        strategyConfig: params.config ?? {
          MODE: 'candidate',
          MAX_LOSS_VALUE: 10,
        },
      },
      stat: {
        orders: params.orders ?? 1,
        wins: params.wins ?? 1,
        losses: params.losses ?? 0,
        netProfit: params.pnl ?? 10,
      },
    },
  }) as never;

describe('core research run reconciliation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('does not touch Redis when a variant has no explicit run id', async () => {
    const variant = makeVariant({ id: 'candidate', role: 'candidate' });
    const result = await reconcileCoreResearchVariant({
      variant,
      spec: makeSpec(),
      exportMetrics: summarizeCoreResearchTrades([makeTrade()], 10),
    });
    expect(result).toMatchObject({
      status: 'not_requested',
      runId: null,
      reasons: ['variant.runId is not set'],
    });
    expect(mockedManifest).not.toHaveBeenCalled();
  });

  it('reports an unavailable immutable manifest distinctly from a mismatch', async () => {
    mockedManifest.mockResolvedValue(null);
    mockedCompleted.mockResolvedValue([]);
    const result = await reconcileCoreResearchVariant({
      variant: makeVariant({
        id: 'candidate',
        role: 'candidate',
        runId: 'run-1',
      }),
      spec: makeSpec(),
      exportMetrics: summarizeCoreResearchTrades([], 10),
    });
    expect(result).toMatchObject({
      status: 'unavailable',
      reasons: ['backtest manifest is unavailable'],
    });
  });

  it('accepts a completed isolated run with exact universe/config/NWL and rounding-only PnL delta', async () => {
    const spec = makeSpec();
    const variant = makeVariant({
      id: 'candidate',
      role: 'candidate',
      runId: 'run-1',
    });
    mockedManifest.mockResolvedValue({
      runId: 'run-1',
      status: 'completed',
      userName: 'root',
      config: variant.configName,
      command: [],
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
      connectorName: spec.execution.connector,
      interval: spec.execution.interval,
      window: { ...spec.window, source: 'explicit' },
      preloadStart: spec.window.start,
      flags: {
        ai: true,
        backtestEntryDelayBars: 1,
        backtestPriceMode: 'close',
        cacheOnly: true,
        fast: true,
        ml: false,
      },
      testSuite: spec.universe.symbols.map((symbol) => ({
        symbol,
        strategyName: spec.strategy,
        strategyConfig: variant.resolvedConfig,
      })) as never,
    });
    mockedCompleted.mockResolvedValue([
      checkpoint({ symbol: 'AAAUSDT', pnl: 5 }),
      checkpoint({ symbol: 'BBBUSDT', pnl: 5 }),
    ]);

    const exportMetrics = summarizeCoreResearchTrades(
      [
        makeTrade({ signalId: '1', netProfit: 5 }),
        makeTrade({ signalId: '2', netProfit: 5.005 }),
      ],
      10,
    );
    const result = await reconcileCoreResearchVariant({
      variant,
      spec,
      exportMetrics,
    });
    expect(result).toMatchObject({
      status: 'match',
      plannedTests: 2,
      completedTests: 2,
      redis: { trades: 2, wins: 2, losses: 0, pnl: 10 },
      delta: { trades: 0, wins: 0, losses: 0 },
    });
    expect(result.delta?.pnl).toBeCloseTo(0.005);
    expect(result.reasons).toEqual([]);

    const wrongCosts = {
      ...spec,
      execution: {
        ...spec.execution,
        costs: {
          ...spec.execution.costs,
          fees: { makerRate: 0, takerRate: 0.003 },
        },
      },
    };
    const mismatch = await reconcileCoreResearchVariant({
      variant,
      spec: wrongCosts,
      exportMetrics,
    });
    expect(mismatch.status).toBe('mismatch');
    expect(mismatch.reasons).toContain(
      'executed costs do not match the preregistered execution costs',
    );
  });

  it('collects all causal lineage and economic mismatch reasons in one audit', async () => {
    const spec = makeSpec();
    const variant = makeVariant({
      id: 'candidate',
      role: 'candidate',
      runId: 'run-2',
    });
    mockedManifest.mockResolvedValue({
      runId: 'run-2',
      status: 'running',
      userName: 'root',
      config: 'Wrong:config',
      command: [],
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
      connectorName: 'WrongConnector',
      interval: '60',
      window: { start: 1, end: 2, source: 'wrong' },
      preloadStart: 1,
      flags: {
        ai: false,
        backtestEntryDelayBars: 0,
        backtestPriceMode: 'close',
        cacheOnly: true,
        fast: true,
        ml: false,
      },
      testSuite: [
        { symbol: 'WRONGUSDT', strategyName: 'WrongStrategy' },
        { symbol: 'EXTRAUSDT', strategyName: 'WrongStrategy' },
      ] as never,
    });
    mockedCompleted.mockResolvedValue([
      checkpoint({
        symbol: 'WRONGUSDT',
        configId: 'first',
        config: { WRONG: true },
        orders: 1,
        wins: 0,
        losses: 1,
        pnl: -100,
      }),
    ]);
    const result = await reconcileCoreResearchVariant({
      variant,
      spec,
      exportMetrics: summarizeCoreResearchTrades(
        [
          makeTrade({ netProfit: 10 }),
          makeTrade({ signalId: 'extra', netProfit: 10 }),
        ],
        10,
      ),
    });
    expect(result.status).toBe('mismatch');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'manifest status is running',
        'manifest window does not match the preregistered window',
        'manifest connector does not match the preregistered connector',
        'manifest interval does not match the preregistered interval',
        'manifest did not enable raw AI dataset transport',
        'checkpoint completion is 1/2',
        'manifest test suite does not match the frozen ordered universe',
        'manifest includes a different strategy',
        'executed resolved strategy config does not match the preregistered config SHA',
        'export N/W/L does not match Redis result.stat',
      ]),
    );
    expect(
      result.reasons.some((reason) => reason.startsWith('export PnL delta')),
    ).toBe(true);
  });
});
