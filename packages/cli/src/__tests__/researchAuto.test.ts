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

const mockSpawn = jest.fn();
const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

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
    info: (...args: unknown[]) => mockLoggerInfo(...args),
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
  runCliCommand,
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

  it('renders TG report with escaped values, metrics, and pending agent status', () => {
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
    expect(report).toContain('Agent layer: <code>pending</code>');
  });

  it('renders TG report with completed agent details when agentRun exists', () => {
    const report = buildTelegramReport({
      runId: 'run-2',
      userName: 'root',
      strategy: 'ReverseTrendLine',
      config: 'ReverseTrendLine:research',
      connector: 'bybit',
      timeframe: '15',
      days: 45,
      recent: 1000,
      skip: 0,
      minQuality: 4,
      selectedBy: 'auto',
      status: 'completed',
      startedAt: '2026-04-29T21:00:00.000Z',
      finishedAt: '2026-04-29T21:20:00.000Z',
      steps: {
        prepareBacktestConfig: { status: 'completed', command: '', args: [] },
        cleanTests: { status: 'completed', command: '', args: [] },
        cleanAiExport: { status: 'completed', command: '', args: [] },
        backtest: { status: 'completed', command: '', args: [] },
        aiExport: { status: 'completed', command: '', args: [] },
        aiTrainLocal: { status: 'completed', command: '', args: [] },
        agentRun: { status: 'completed', command: '', args: [] },
      },
      artifacts: {
        agentRun: {
          status: 'completed',
          strategy: 'ReverseTrendLine',
          runId: 'run-2',
          branchName: 'codex/research/reverse-trend-line-run-2',
          commitHash: 'abc123',
          pullRequestNumber: 42,
          pullRequestUrl: 'https://github.com/TradeJS-Dev/TradeJS/pull/42',
          summary: 'Committed validated patch and created PR #42',
          startedAt: '2026-04-29T21:10:00.000Z',
          finishedAt: '2026-04-29T21:20:00.000Z',
        },
      },
    });

    expect(report).toContain('Agent layer: <code>completed</code>');
    expect(report).toContain(
      'Agent branch: <code>codex/research/reverse-trend-line-run-2</code>',
    );
    expect(report).toContain('Agent commit: <code>abc123</code>');
    expect(report).toContain('Agent PR: <code>#42</code>');
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

  it('surfaces invalid structured json output errors', () => {
    expect(() => parseJsonOutput('not-json', 'agent-run --json')).toThrow(
      'not valid JSON',
    );
  });

  it('treats invalid latest run timestamps as oldest candidates', async () => {
    mockGetKeys.mockResolvedValue([
      'users:root:strategies:TrendLine:config',
      'users:root:strategies:Breakout:config',
    ]);

    mockGetData.mockImplementation(async (key: string) => {
      if (key.endsWith(':TrendLine')) {
        return { finishedAt: 'not-a-date' };
      }
      if (key.endsWith(':Breakout')) {
        return { finishedAt: '2026-04-24T23:00:00.000Z' };
      }
      return null;
    });

    await expect(resolveTarget()).resolves.toEqual({
      strategy: 'TrendLine',
      config: 'TrendLine:research',
      selectedBy: 'auto',
    });
  });

  it('streams child output into research logs when liveLogPrefix is enabled', async () => {
    const stdoutHandlers: Record<string, (value: Buffer) => void> = {};
    const stderrHandlers: Record<string, (value: Buffer) => void> = {};
    const childHandlers: Record<string, (...args: any[]) => void> = {};

    mockSpawn.mockReturnValue({
      stdout: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stdoutHandlers[event] = handler;
        },
      },
      stderr: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stderrHandlers[event] = handler;
        },
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        childHandlers[event] = handler;
      },
    });

    const pending = runCliCommand({
      command: 'backtest',
      args: ['--config', 'TrendLine:research'],
      liveLogPrefix: 'backtest',
    });

    stdoutHandlers.data?.(Buffer.from('progress 1\nprogress 2\n'));
    stderrHandlers.data?.(Buffer.from('warn 1\n'));
    childHandlers.close?.(0);

    await expect(pending).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'progress 1\nprogress 2\n',
      stderr: 'warn 1\n',
    });
    expect(mockLoggerInfo).toHaveBeenCalled();
  });

  it('keeps only the configured tail of stdout/stderr by default', async () => {
    const stdoutHandlers: Record<string, (value: Buffer) => void> = {};
    const stderrHandlers: Record<string, (value: Buffer) => void> = {};
    const childHandlers: Record<string, (...args: any[]) => void> = {};

    mockSpawn.mockReturnValue({
      stdout: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stdoutHandlers[event] = handler;
        },
      },
      stderr: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stderrHandlers[event] = handler;
        },
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        childHandlers[event] = handler;
      },
    });

    const pending = runCliCommand({
      command: 'backtest',
      args: [],
      tailLimit: 512,
    });

    stdoutHandlers.data?.(Buffer.from('a'.repeat(400)));
    stdoutHandlers.data?.(Buffer.from('b'.repeat(400)));
    stderrHandlers.data?.(Buffer.from('c'.repeat(520)));
    childHandlers.close?.(0);

    await expect(pending).resolves.toMatchObject({
      exitCode: 0,
      stdout: `${'a'.repeat(112)}${'b'.repeat(400)}`,
      stderr: 'c'.repeat(512),
    });
  });

  it('captures full stdout/stderr when captureMode=full is requested', async () => {
    const stdoutHandlers: Record<string, (value: Buffer) => void> = {};
    const stderrHandlers: Record<string, (value: Buffer) => void> = {};
    const childHandlers: Record<string, (...args: any[]) => void> = {};

    mockSpawn.mockReturnValue({
      stdout: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stdoutHandlers[event] = handler;
        },
      },
      stderr: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stderrHandlers[event] = handler;
        },
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        childHandlers[event] = handler;
      },
    });

    const pending = runCliCommand({
      command: 'ai-train',
      args: ['--json'],
      captureMode: 'full',
      tailLimit: 5,
    });

    stdoutHandlers.data?.(Buffer.from('1234'));
    stdoutHandlers.data?.(Buffer.from('56789'));
    stderrHandlers.data?.(Buffer.from('abcdef'));
    childHandlers.close?.(0);

    await expect(pending).resolves.toMatchObject({
      exitCode: 0,
      stdout: '123456789',
      stderr: 'abcdef',
    });
  });

  it('returns non-zero exit codes with captured stderr for failure analysis', async () => {
    const stdoutHandlers: Record<string, (value: Buffer) => void> = {};
    const stderrHandlers: Record<string, (value: Buffer) => void> = {};
    const childHandlers: Record<string, (...args: any[]) => void> = {};

    mockSpawn.mockReturnValue({
      stdout: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stdoutHandlers[event] = handler;
        },
      },
      stderr: {
        on: (event: string, handler: (value: Buffer) => void) => {
          stderrHandlers[event] = handler;
        },
      },
      on: (event: string, handler: (...args: any[]) => void) => {
        childHandlers[event] = handler;
      },
    });

    const pending = runCliCommand({
      command: 'agent-run',
      args: ['--json'],
      tailLimit: 512,
    });

    stdoutHandlers.data?.(Buffer.from('partial stdout\n'));
    stderrHandlers.data?.(Buffer.from('fatal failure\n'));
    childHandlers.close?.(2);

    await expect(pending).resolves.toMatchObject({
      exitCode: 2,
      stdout: 'partial stdout\n',
      stderr: 'fatal failure\n',
    });
  });

  it('rejects when spawning the child process itself fails', async () => {
    const childHandlers: Record<string, (...args: any[]) => void> = {};

    mockSpawn.mockReturnValue({
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: (event: string, handler: (...args: any[]) => void) => {
        childHandlers[event] = handler;
      },
    });

    const pending = runCliCommand({
      command: 'backtest',
      args: ['--config', 'TrendLine:research'],
    });

    childHandlers.error?.(new Error('spawn failed'));

    await expect(pending).rejects.toThrow('spawn failed');
  });
});
