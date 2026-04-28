jest.mock('args', () => ({
  __esModule: true,
  default: {
    example: jest.fn(),
    option: jest.fn(),
    parse: jest.fn(() => ({
      user: 'root',
      connector: 'bybit',
      timeframe: '15',
      days: 45,
      recent: 1000,
      skip: 0,
      minQuality: 4,
      outDir: 'data/ai/export',
      json: false,
    })),
  },
}));

const mockGetData = jest.fn();
const mockGetKeys = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  setData: jest.fn(),
  redisKeys: {
    strategies: (userName: string) => `users:${userName}:strategies`,
    researchLatestRun: (userName: string, strategy: string) =>
      `users:${userName}:research:latest:${strategy}`,
  },
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  buildTelegramReport,
  listRuntimeStrategyNames,
  parseJsonOutput,
  resolveStrategyNameByConfigKey,
  resolveTarget,
  toStrategyConfigGrid,
} from '../scripts/researchAuto';

describe('research:auto helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps every strategy config field into a single-value grid for :research backtests', () => {
    const source = {
      AI_ENABLED: true,
      AI_MODE: 'llm',
      MIN_AI_QUALITY: 4,
      TRENDLINE: { minTouches: 3, maxDistancePct: 0.8 },
      TAGS: ['a', 'b'],
    };

    expect(toStrategyConfigGrid(source)).toEqual({
      AI_ENABLED: [true],
      AI_MODE: ['llm'],
      MIN_AI_QUALITY: [4],
      TRENDLINE: [{ minTouches: 3, maxDistancePct: 0.8 }],
      TAGS: [['a', 'b']],
    });
  });

  it('selects the strategy with the oldest or missing research run', async () => {
    mockGetKeys.mockResolvedValue([
      'users:root:strategies:TrendLine:config',
      'users:root:strategies:Breakout:config',
      'users:root:strategies:VolumeDivergence:config',
    ]);

    mockGetData.mockImplementation(async (key: string) => {
      if (key.endsWith(':TrendLine')) {
        return { finishedAt: '2026-04-24T21:00:00.000Z' };
      }
      if (key.endsWith(':Breakout')) {
        return { finishedAt: '2026-04-24T23:00:00.000Z' };
      }
      if (key.endsWith(':VolumeDivergence')) {
        return null;
      }
      return null;
    });

    await expect(resolveTarget()).resolves.toEqual({
      strategy: 'VolumeDivergence',
      config: 'VolumeDivergence:research',
      selectedBy: 'auto',
    });
  });

  it('lists only runtime strategy names from Redis config keys', async () => {
    mockGetKeys.mockResolvedValue([
      'users:root:strategies:TrendLine:config',
      'users:root:strategies:TrendLine:results',
      'users:root:strategies:Breakout:config',
      'users:other:strategies:Ignored:config',
      'broken:key',
    ]);

    await expect(listRuntimeStrategyNames('root')).resolves.toEqual([
      'Breakout',
      'TrendLine',
    ]);
  });

  it('parses strategy name from runtime config key', () => {
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:config',
      ),
    ).toBe('TrendLine');
    expect(
      resolveStrategyNameByConfigKey(
        'root',
        'users:root:strategies:TrendLine:results',
      ),
    ).toBeNull();
  });

  it('renders TG report with escaped values, metrics, and agent placeholder', () => {
    const report = buildTelegramReport({
      runId: 'run-1',
      userName: 'root',
      strategy: 'TrendLine <main>',
      config: 'TrendLine:research',
      connector: 'bybit',
      timeframe: '15',
      days: 45,
      recent: 1000,
      skip: 0,
      minQuality: 4,
      selectedBy: 'auto',
      status: 'completed',
      startedAt: '2026-04-24T21:00:00.000Z',
      finishedAt: '2026-04-24T21:20:00.000Z',
      steps: {
        prepareBacktestConfig: { status: 'completed', command: '', args: [] },
        cleanTests: { status: 'completed', command: '', args: [] },
        cleanAiExport: { status: 'completed', command: '', args: [] },
        backtest: { status: 'completed', command: '', args: [] },
        aiExport: { status: 'completed', command: '', args: [] },
        aiTrainLocal: { status: 'completed', command: '', args: [] },
        agentRun: { status: 'pending', command: '', args: [] },
      },
      artifacts: {
        backtestResultKey: 'users:root:backtests:results:TrendLine:research:1',
        aiExportFile: '/tmp/ai-dataset-trendline-merged-1.jsonl',
        aiTrainLocal: {
          run: {
            totalRows: 100,
            approvedRows: 24,
            minQuality: 4,
          },
          outcome: {
            approvalRate: 0.24,
            precisionApproved: 0.75,
            recallWinners: 0.31,
            avgProfitApproved: 1.42,
            avgProfitApprovedPerMonth: 12.8,
            expectancyDelta: 0.53,
          },
        },
      },
    });

    expect(report).toContain('TrendLine &lt;main&gt;');
    expect(report).toContain(
      'Backtest config: <code>TrendLine:research</code>',
    );
    expect(report).toContain(
      'Rows: <code>100</code>, approved: <code>24</code>',
    );
    expect(report).toContain('Approval rate: <code>0.2400</code>');
    expect(report).toContain('Agent layer: <code>not implemented</code>');
  });

  it('parses ai-train structured JSON output', () => {
    expect(
      parseJsonOutput<{ outcome: { approvalRate: number } }>(
        '{"outcome":{"approvalRate":0.42}}',
        'ai-train --json',
      ),
    ).toEqual({
      outcome: {
        approvalRate: 0.42,
      },
    });
  });
});
