/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createNativeStrategyResearchBackend,
  runResearchCommand,
  validateResearchJevTraining,
} from '../native';

it('rejects Jev models fitted on the sealed TEST period or lacking training boundaries', () => {
  expect(() => validateResearchJevTraining({}, START)).toThrow('before');
  expect(() =>
    validateResearchJevTraining(
      { training: { trainEnd: START, validationEnd: START } },
      START,
    ),
  ).toThrow('before');
  expect(() =>
    validateResearchJevTraining(
      { training: { trainEnd: START - 1, validationEnd: START - 1 } },
      START,
    ),
  ).not.toThrow();
});
import { createStrategyResearchSpec } from '../specification';
import {
  makeSpec,
  makeDatasetRow,
  START,
} from '../../coreResearch/__fixtures__/fixtures';
import {
  calendarMeanInterval,
  measureResearchEvents,
  summarizeResearchEvents,
} from '../events';
import type { Candle } from '@tradejs/types';
import { getData, setData } from '@tradejs/infra/redis';
import {
  loadBacktestRunManifest,
  loadBacktestCheckpointResults,
} from '../../backtest/checkpoint';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import { buildAiPayload, runAiPromptLocal } from '@tradejs/node/ai';
import { buildResearchEntryPayload } from '@tradejs/node/backtest';

const mockExecFileSync = jest.fn();
const mockReconcile = jest.fn();
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));
jest.mock('../../coreResearch/reconciliation', () => ({
  reconcileCoreResearchVariant: (...args: unknown[]) => mockReconcile(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: jest.fn(),
  setData: jest.fn(),
  redisKeys: {
    backtestConfig: jest.fn((user: string, name: string) => `${user}:${name}`),
  },
}));
jest.mock('@tradejs/node/ai', () => ({
  runAiPromptLocal: jest.fn(),
  buildAiPayload: jest.fn(),
  getDeterministicAiGateContext: jest.fn(),
}));
jest.mock('@tradejs/node/backtest', () => ({
  buildResearchEntryPayload: jest.fn(),
  parseResearchEntryPolicy: jest.fn(),
  RESEARCH_ENTRY_POLICY_CAPABILITIES: { directionSelection: true },
}));
jest.mock('@tradejs/node/connectors', () => ({
  getConnectorCreatorByName: jest.fn(),
}));
jest.mock('@tradejs/node/registry', () => ({
  ensureStrategyPluginsLoaded: jest.fn(),
}));
jest.mock('../../backtest/checkpoint', () => ({
  loadBacktestRunManifest: jest.fn(),
  loadBacktestCheckpointResults: jest.fn(),
}));
jest.mock('../../aiTrainResearch', () => ({
  fingerprintResearchContextEnvironment: jest.fn(() => 'e'.repeat(64)),
}));

describe('native strategy research process and event evidence', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-native-research-'));
    jest.spyOn(os, 'freemem').mockReturnValue(16 * 1024 ** 3);
    mockExecFileSync.mockReset().mockReturnValue('');
    mockReconcile
      .mockReset()
      .mockResolvedValue({ status: 'match', reasons: [] });
    jest.mocked(getData).mockResolvedValue(null);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });
  it('derives the common 60/40 boundary from timestamp groups without evaluating outcomes', async () => {
    const file = path.join(root, 'metadata.jsonl');
    await fs.writeFile(
      file,
      Array.from({ length: 10 }, (_, index) =>
        JSON.stringify({
          timestamp: START + index * 1000,
          profit: index % 2 ? 1e9 : -1e9,
        }),
      ).join('\n'),
    );
    const spec = createStrategyResearchSpec(makeSpec());
    const backend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: process.execPath,
    });
    const partition = await backend.selectPartition(spec, {
      ...spec.core.variants[0],
      files: [file],
    });
    expect(partition).toEqual({
      testSince: START + 6000,
      events: 10,
      method: 'outer-60-40-timestamp-groups',
    });
    await fs.writeFile(file, '');
    expect(
      (
        await backend.selectPartition(spec, {
          ...spec.core.variants[0],
          files: [file],
        })
      ).events,
    ).toBe(0);
  });

  it('reuses a completed zero-trade native run and writes an explicit empty export', async () => {
    const spec = createStrategyResearchSpec(makeSpec());
    const backend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: process.execPath,
    });
    jest.mocked(loadBacktestRunManifest).mockResolvedValue({
      status: 'completed',
      testSuite: [],
    } as unknown as NonNullable<
      Awaited<ReturnType<typeof loadBacktestRunManifest>>
    >);
    jest.mocked(loadBacktestCheckpointResults).mockResolvedValue([]);
    const folder = path.join(root, 'run');
    const variant = await backend.runVariant(
      spec,
      { ...spec.core.variants[0], files: [] },
      folder,
      async () => undefined,
      'existing-run',
    );
    expect(variant.runId).toBe('existing-run');
    expect(variant.files).toEqual([path.join(folder, 'verified-empty.jsonl')]);
    expect(await fs.readFile(variant.files[0], 'utf8')).toBe('');
    expect(setData).toHaveBeenCalled();
    const data = await backend.loadDataset(
      { ...spec, testSince: START + 86400000 },
      variant,
      folder,
      true,
    );
    expect(data.trades).toEqual([]);
    expect(data.rows).toEqual([]);
  });

  it('launches the exact native backtest and exports only its immutable run', async () => {
    const spec = createStrategyResearchSpec(makeSpec());
    const cli = path.join(root, 'native.cjs');
    const commands = path.join(root, 'commands.jsonl');
    const exported = path.join(root, 'export.jsonl');
    await fs.writeFile(exported, '');
    await fs.writeFile(
      cli,
      `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(commands)},JSON.stringify(process.argv.slice(2))+'\\n');console.log(process.argv[2]==='backtest'?'backtest run id: 202601010000-aaaaaaaa':'part1: '+${JSON.stringify(exported)});`,
    );
    jest.mocked(loadBacktestRunManifest).mockResolvedValue({
      status: 'completed',
      testSuite: [{}],
    } as unknown as NonNullable<
      Awaited<ReturnType<typeof loadBacktestRunManifest>>
    >);
    jest
      .mocked(loadBacktestCheckpointResults)
      .mockResolvedValue([
        { result: { stat: { orders: 1 } } },
      ] as unknown as Awaited<
        ReturnType<typeof loadBacktestCheckpointResults>
      >);
    const backend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: cli,
    });
    const onId = jest.fn(async () => undefined);
    const result = await backend.runVariant(
      spec,
      { ...spec.core.variants[0], files: [] },
      path.join(root, 'generated'),
      onId,
    );
    expect(onId).toHaveBeenCalledWith('202601010000-aaaaaaaa');
    expect(result.files).toEqual([exported]);
    expect(result.resolvedConfig).toMatchObject({
      ENV: 'BACKTEST',
      BACKTEST_ENTRY_DELAY_BARS: 1,
      MAKE_ORDERS: true,
    });
    const calls = (await fs.readFile(commands, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        'backtest',
        '--cacheOnly',
        '--fast',
        '--researchTrace',
        '--executionCosts',
        'AAAUSDT,BBBUSDT',
      ]),
    );
    expect(calls[1]).toEqual(
      expect.arrayContaining(['ai-export', '--runId', '202601010000-aaaaaaaa']),
    );
    expect(calls).toHaveLength(2);
  });
  it('refuses changed frozen Redis configs and missing resumed manifests without relaunching', async () => {
    const spec = createStrategyResearchSpec(makeSpec());
    const backend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: process.execPath,
    });
    jest.mocked(getData).mockResolvedValue({ different: [1] });
    await expect(
      backend.runVariant(
        spec,
        { ...spec.core.variants[0], files: [] },
        path.join(root, 'changed'),
        async () => undefined,
      ),
    ).rejects.toThrow('Frozen research config changed');
    jest.mocked(getData).mockResolvedValue(null);
    jest.mocked(loadBacktestRunManifest).mockResolvedValue(null);
    await expect(
      backend.runVariant(
        spec,
        { ...spec.core.variants[0], files: [] },
        path.join(root, 'missing'),
        async () => undefined,
        'missing-run',
      ),
    ).rejects.toThrow('manifest is unavailable');
  });

  it('loads reconciled causal context and purges a development label crossing the boundary', async () => {
    const spec = createStrategyResearchSpec(makeSpec());
    spec.testSince = START + 86400000;
    const row = makeDatasetRow({
      signalId: 'mature',
      timestamp: START,
      exitTimestamp: START + 60_000,
    });
    const context = {
      candle: {
        timestamp: START,
        open: 100,
        high: 102,
        low: 99,
        close: 100,
        volume: 10,
        turnover: 1000,
      },
      regime: { trend: { bias: 'bull' }, volatility: { state: 'normal' } },
    };
    row.payload.additionalIndicators = { baseContext: context };
    const crossing = makeDatasetRow({
      signalId: 'crossing',
      timestamp: START + 120_000,
      exitTimestamp: spec.testSince + 60_000,
    });
    crossing.payload.additionalIndicators = {
      baseContext: {
        ...context,
        candle: { ...context.candle, timestamp: START + 120_000 },
      },
    };
    const file = path.join(root, 'rows.jsonl');
    await fs.writeFile(
      file,
      [row, crossing].map((value) => JSON.stringify(value)).join('\n'),
    );
    jest.mocked(buildResearchEntryPayload).mockImplementation((signal) => ({
      signal: { ...signal },
      figures: {},
      indicators: {},
      additionalIndicators: signal.additionalIndicators,
    }));
    jest
      .mocked(buildAiPayload)
      .mockImplementation(jest.mocked(buildResearchEntryPayload));
    jest
      .mocked(runAiPromptLocal)
      .mockResolvedValue({ direction: 'LONG', quality: 4 });
    jest.mocked(getConnectorCreatorByName).mockResolvedValue(
      jest.fn(async () => ({
        kline: jest.fn(async () => []),
      })) as unknown as NonNullable<
        Awaited<ReturnType<typeof getConnectorCreatorByName>>
      >,
    );
    const backend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: process.execPath,
    });
    const data = await backend.loadDataset(
      spec,
      { ...spec.core.variants[0], files: [file] },
      root,
      true,
    );
    expect(data.rows).toHaveLength(1);
    expect(data.purgedLabels).toBe(1);
    expect(data.contextCoverage).toEqual({
      'regime.trend.bias': 1,
      'regime.volatility.state': 1,
    });
    mockReconcile.mockResolvedValue({
      status: 'mismatch',
      reasons: ['missing rows'],
    });
    await expect(
      backend.loadDataset(
        spec,
        { ...spec.core.variants[0], files: [file] },
        root,
        true,
      ),
    ).rejects.toThrow('missing rows');
  });

  it('binds source, executable and installed modules and rejects missing cached history', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    for (const [name, exports] of [
      [
        'node',
        { './backtest': './dist/backtest.cjs', './ai': './dist/ai.cjs' },
      ],
      ['core', { './strategies': './dist/strategies.cjs' }],
    ] as const) {
      const directory = path.join(root, 'node_modules/@tradejs', name);
      await fs.mkdir(path.join(directory, 'dist'), { recursive: true });
      await fs.writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: `@tradejs/${name}`, exports }),
      );
      for (const target of Object.values(exports))
        await fs.writeFile(
          path.join(directory, target),
          'module.exports={parseResearchEntryPolicy(){},buildResearchEntryPayload(){},RESEARCH_ENTRY_POLICY_CAPABILITIES:{directionSelection:true}};',
        );
    }
    mockExecFileSync.mockImplementation((_command: string, args: string[]) =>
      args[0] === 'rev-parse' ? 'a'.repeat(40) : '',
    );
    const spec = createStrategyResearchSpec(makeSpec());
    spec.budget.minimumFreeMemoryMb = 1;
    await fs.mkdir(
      path.join(root, 'data/research/strategy', spec.core.researchId),
      { recursive: true },
    );
    await fs.writeFile(path.join(root, 'cli.cjs'), '// frozen fixture');
    const sourceBackend = createNativeStrategyResearchBackend({
      projectRoot: root,
      sourceRepositoryRoot: root,
      cliPath: path.join(root, 'cli.cjs'),
    });
    const lineage = await sourceBackend.lineage();
    expect(lineage.sourceGitSha).toBe('a'.repeat(40));
    expect(lineage.runtimeSha256).toMatch(/^[a-f0-9]{64}$/);
    jest.mocked(getConnectorCreatorByName).mockResolvedValue(
      jest.fn(async () => ({
        kline: jest.fn(async () => []),
      })) as unknown as NonNullable<
        Awaited<ReturnType<typeof getConnectorCreatorByName>>
      >,
    );
    await expect(sourceBackend.preflight(spec)).rejects.toThrow(
      'No cached history',
    );
  });
  it('captures split stdout lines, literal arguments and durable process completion', async () => {
    const lines: string[] = [];
    const log = path.join(root, 'native.log'),
      processReceipt = path.join(root, 'process.json');
    const literal = '$(not-a-command); literal argument';
    await runResearchCommand({
      executable: process.execPath,
      args: [
        '-e',
        "process.stdout.write('backtest run ');setTimeout(()=>{console.log('id: fixture');console.log(process.argv[1]);},10)",
        literal,
      ],
      cwd: root,
      log,
      processReceipt,
      timeoutMs: 5000,
      onLine: (line) => {
        lines.push(line);
      },
    });
    expect(lines).toEqual(['backtest run id: fixture', literal]);
    expect(await fs.readFile(log, 'utf8')).toContain(literal);
    expect(JSON.parse(await fs.readFile(processReceipt, 'utf8')).status).toBe(
      'finished',
    );
  });
  it('reports command failures and timeouts and refuses duplicate live processes', async () => {
    await expect(
      runResearchCommand({
        executable: process.execPath,
        args: ['-e', 'process.exit(7)'],
        cwd: root,
        log: path.join(root, 'error.log'),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('failed');
    await expect(
      runResearchCommand({
        executable: process.execPath,
        args: ['-e', 'setInterval(()=>{},1000)'],
        cwd: root,
        log: path.join(root, 'timeout.log'),
        timeoutMs: 50,
      }),
    ).rejects.toThrow('failed');
    const processReceipt = path.join(root, 'alive.json');
    await fs.writeFile(
      processReceipt,
      JSON.stringify({ pid: process.pid, status: 'running' }),
    );
    await expect(
      runResearchCommand({
        executable: process.execPath,
        args: ['-e', 'process.exit(0)'],
        cwd: root,
        log: path.join(root, 'duplicate.log'),
        processReceipt,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow('no duplicate');
  });
  it('measures MAE/MFE and fixed horizons without fabricating missing future bars', () => {
    const candles: Candle[] = Array.from({ length: 125 }, (_, index) => ({
      timestamp: START + index * 900000,
      open: 100 + index,
      close: 101 + index,
      high: 102 + index,
      low: 99 + index,
      volume: 10,
      turnover: 1000,
    }));
    const event = {
      signalId: 'event',
      timestamp: candles[110].timestamp,
      symbol: 'AAAUSDT',
      direction: 'LONG' as const,
      price: 211,
      risk: 5,
    };
    const measured = measureResearchEvents(
      [event],
      candles,
      [1, 4, 96],
      900000,
      START + 130 * 900000,
    );
    expect(measured).toHaveLength(2);
    expect(measured[0]).toMatchObject({ moveR: 0.2, mfeR: 0.4, maeR: 0.2 });
    const report = summarizeResearchEvents(
      measured,
      [1, 4],
      START,
      START + 130 * 900000,
    );
    expect(report[0]).toMatchObject({
      side: 'ALL',
      events: 1,
      controlPairs: 1,
      meanInterval95: null,
    });
    const gap = candles.filter((_, index) => index !== 111);
    expect(
      measureResearchEvents([event], gap, [1], 900000, START + 130 * 900000),
    ).toHaveLength(0);
  });
  it('resamples whole calendar blocks deterministically and keeps insufficient support unavailable', () => {
    expect(
      calendarMeanInterval(
        [{ timestamp: START, value: 2 }],
        START,
        START + 86400000,
        'seed',
      ),
    ).toBeNull();
    const rows = Array.from({ length: 28 }, (_, index) => ({
      timestamp: START + index * 86400000,
      value: 2,
    }));
    expect(
      calendarMeanInterval(rows, START, START + 28 * 86400000, 'seed'),
    ).toEqual([2, 2]);
  });
});
