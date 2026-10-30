/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiPayload, ResearchEntryPolicy } from '@tradejs/types';
import {
  createStrategyResearchSpec,
  validateStrategyResearchSpec,
} from '../specification';
import { runStrategyResearch } from '../orchestrator';
import {
  boundResearchPath,
  readJson,
  verifyCompletedResearch,
  withResearchLock,
} from '../io';
import { discoverResearchGate } from '../gates';
import { evaluateResearchComposition } from '../evaluation';
import { buildResearchCaseSvg, escapeResearchHtml } from '../report';
import {
  makeSpec,
  makeTrade,
  START,
  END,
} from '../../coreResearch/__fixtures__/fixtures';
import type { CoreResearchVariant } from '../../coreResearch/types';
import type {
  ResearchDataset,
  StrategyResearchBackend,
  StrategyResearchSpec,
} from '../types';
import { matchesResearchEntryRules } from '@tradejs/node/backtest';
import { assertNoResearchFileConsumers } from '../../strategyRelease/researchFileConsumers';

jest.mock('../../strategyRelease/researchFileConsumers', () => ({
  assertNoResearchFileConsumers: jest.fn(async () => undefined),
}));

jest.mock('@tradejs/node/ai', () => ({
  buildAiPayload: jest.fn(),
  runAiPromptLocal: jest.fn(),
  getDeterministicAiGateContext: jest.fn(() => null),
}));

const feature =
  'additionalIndicators.baseContext.structure.localRange.rangePosition20';
const specFixture = (id = 'automatic-fixture'): StrategyResearchSpec => {
  const spec = createStrategyResearchSpec(makeSpec({ researchId: id }));
  spec.testSince = Math.floor(START + (END - START) * 0.6);
  spec.core.variants = spec.core.variants.map((variant) => ({
    ...variant,
    files: [],
  }));
  spec.selection = {
    ...spec.selection,
    minimumEvents: 25,
    maximumDrawdown: 1000,
    maximumSymbolShare: 1,
    maximumEventShare: 1,
    minimumCadencePerDay: 0,
  };
  spec.budget.maxCombinations = 1000;
  spec.diagnostics.minimumContextCoverage = 1;
  return validateStrategyResearchSpec(spec);
};

const makeDataset = (
  spec: StrategyResearchSpec,
  variant: CoreResearchVariant,
  discoveryOnly: boolean,
): ResearchDataset => {
  const trades = [];
  const rows = [];
  const policy = variant.resolvedConfig.RESEARCH_ENTRY_POLICY as
    | ResearchEntryPolicy
    | undefined;
  for (let index = 0; index < 400; index++)
    for (const side of ['LONG', 'SHORT'] as const) {
      const timestamp = START + index * 30 * 60_000;
      if (
        timestamp >= spec.core.window.end ||
        (discoveryOnly && timestamp + 60_000 >= spec.testSince)
      )
        continue;
      const good = index % 2 === 0;
      const payload = {
        additionalIndicators: {
          baseContext: {
            structure: { localRange: { rangePosition20: good ? 0.8 : 0.2 } },
          },
        },
      } as AiPayload;
      if (policy) {
        if (policy.directions && !policy.directions.includes(side)) continue;
        if (policy.mode === 'current-gate') {
          if (index % 3 !== 0) continue;
        } else {
          const rules = policy.rules[side];
          if (rules === null || !matchesResearchEntryRules(payload, rules))
            continue;
        }
      }
      const netProfit = good ? (variant.id.includes('candidate') ? 4 : 3) : -1;
      const trade = makeTrade({
        signalId: `${side}-${index}`,
        symbol: 'AAAUSDT',
        strategy: spec.core.strategy,
        direction: side,
        signalTimestamp: timestamp,
        entryTimestamp: timestamp + 1000,
        exitTimestamp: timestamp + 60_000,
        netProfit,
      });
      trades.push(trade);
      rows.push({
        signalId: trade.signalId,
        symbol: trade.symbol,
        timestamp,
        exitTimestamp: trade.exitTimestamp,
        direction: side,
        profit: netProfit,
        profitableTrade: good,
        quality: good ? 4 : 1,
        aiApproved: good,
        features: { [feature]: good ? 0.8 : 0.2 },
      });
    }
  const candle = {
    timestamp: START,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 10,
    turnover: 1000,
  };
  return {
    variant,
    trades,
    rows,
    samples: trades.length
      ? [
          {
            trade: trades[0],
            stop: 95,
            target: 110,
            candles: [
              candle,
              { ...candle, timestamp: START + 900000, close: 102 },
            ],
          },
        ]
      : [],
    contextCoverage: { 'regime.trend.bias': 1, 'regime.volatility.state': 1 },
    purgedLabels: 0,
  };
};

const backendFixture = (): StrategyResearchBackend => ({
  selectPartition: jest.fn(async (spec) => ({
    testSince: Math.floor(
      spec.core.window.start +
        (spec.core.window.end - spec.core.window.start) * 0.6,
    ),
    events: 400,
    method: 'fixture-timestamp-groups',
  })),
  lineage: jest.fn(async () => ({
    sourceGitSha: 'a'.repeat(40),
    fixture: 'synthetic data for process validation only',
    runtimeSha256: 'b'.repeat(64),
  })),
  preflight: jest.fn(async () => ({ coverage: 'fixture cached history' })),
  runVariant: jest.fn(async (_spec, variant, _directory, onRunId) => {
    await onRunId(`fixture-${variant.id}`);
    return {
      ...variant,
      runId: `fixture-${variant.id}`,
      files: ['fixture.jsonl'],
    };
  }),
  loadDataset: jest.fn(async (spec, variant, _directory, discoveryOnly) =>
    makeDataset(spec, variant, discoveryOnly),
  ),
});

describe('automatic strategy research workflow', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tradejs-workflow-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  it('runs discovery, freezes before TEST, executes gates and writes a self-contained report', async () => {
    const spec = specFixture();
    const backend = backendFixture();
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(result.state.status).toBe('completed');
    expect(result.conclusion.status).toBe('insufficient-data'); // history was already opened
    const events = (
      await fs.readFile(path.join(result.directory, 'events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { stage: string; status: string });
    expect(
      events.findIndex(
        (event) =>
          event.stage === '05-freeze-primary' && event.status === 'completed',
      ),
    ).toBeLessThan(events.findIndex((event) => event.stage === 'holdout'));
    expect(result.state.stages['07-nonfast'].status).toBe('completed');
    expect(result.state.stages['07-delay-stress'].status).toBe('completed');
    const report = await fs.readFile(
      path.join(result.directory, 'report.html'),
      'utf8',
    );
    expect(report).toContain('Недостаточно независимых данных');
    expect(report).toContain('На момент решения');
    expect(report).toContain('LONG');
    expect(report).toContain('SHORT');
    await verifyCompletedResearch(result.directory, result.state);
    await expect(
      fs.stat(path.join(result.directory, '02-raw-control/result.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const retention = await readJson<{ entries: unknown[] }>(
      path.join(result.directory, 'retention.json'),
    );
    expect(retention.entries.length).toBeGreaterThan(0);
    const callCount = jest.mocked(backend.runVariant).mock.calls.length;
    await runStrategyResearch({ spec, projectRoot: root, backend });
    expect(backend.runVariant).toHaveBeenCalledTimes(callCount);
    if (process.env.STRATEGY_RESEARCH_TEST_PREVIEW) {
      await fs.mkdir(process.env.STRATEGY_RESEARCH_TEST_PREVIEW, {
        recursive: true,
      });
      for (const file of [
        'report.html',
        'spec.json',
        'result.json',
        'state.json',
        'retention-status.json',
      ])
        await fs.copyFile(
          path.join(result.directory, file),
          path.join(process.env.STRATEGY_RESEARCH_TEST_PREVIEW, file),
        );
    }
  });
  it('keeps payloads with active consumers and resumes only cleanup after the final handoff', async () => {
    const spec = specFixture('cleanup-resume');
    const backend = backendFixture();
    jest
      .mocked(assertNoResearchFileConsumers)
      .mockRejectedValueOnce(new Error('active reader'));
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(
      await readJson(path.join(result.directory, 'retention-status.json')),
    ).toMatchObject({ status: 'pending' });
    await fs.stat(path.join(result.directory, '02-raw-control/result.json'));
    const calls = jest.mocked(backend.runVariant).mock.calls.length;
    await runStrategyResearch({ spec, projectRoot: root, backend });
    expect(backend.runVariant).toHaveBeenCalledTimes(calls);
    expect(
      await readJson(path.join(result.directory, 'retention-status.json')),
    ).toMatchObject({ status: 'completed' });
    await verifyCompletedResearch(result.directory, result.state);
    const notes = path.join(root, 'notes', spec.core.strategy);
    await fs.appendFile(
      path.join(notes, (await fs.readdir(notes))[0]),
      '\nchanged',
    );
    await expect(
      verifyCompletedResearch(result.directory, result.state),
    ).rejects.toThrow('Changed permanent research record');
  });
  it('freezes LONG from existing DEV and executes only control plus primary on TEST without three direction runs', async () => {
    const spec = specFixture('direction-selection');
    const backend = backendFixture();
    const load = backend.loadDataset;
    backend.loadDataset = jest.fn(async (...args) => {
      const data = await load(...args);
      data.trades = data.trades.map((trade) => ({
        ...trade,
        netProfit: trade.direction === 'SHORT' ? -5 : trade.netProfit,
      }));
      data.rows = data.rows.map((row) => ({
        ...row,
        profit: row.direction === 'SHORT' ? -5 : row.profit,
      }));
      return data;
    });
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(
      result.conclusion.directionSelections.every(
        (item) => item.directions.join(',') === 'LONG',
      ),
    ).toBe(true);
    const calls = jest.mocked(backend.runVariant).mock.calls;
    expect(
      calls.filter((call) => path.basename(call[2]).startsWith('04-dev-')),
    ).toHaveLength(4);
    const testCalls = calls.filter((call) =>
      path.basename(call[2]).startsWith('06-test-'),
    );
    expect(testCalls).toHaveLength(2);
    const primary = testCalls.find((call) => call[1].id !== 'baseline')!;
    expect(primary[1].resolvedConfig.RESEARCH_ENTRY_POLICY).toMatchObject({
      directions: ['LONG'],
    });
    expect(
      result.state.stages['04-freeze-directions'].finishedAt! <=
        result.state.holdoutOpenedAt!,
    ).toBe(true);
    const frozen = await readJson<{ directionSelections: unknown }>(
      path.join(result.directory, '05-freeze-primary/result.json'),
    );
    expect(frozen.directionSelections).toEqual(
      result.conclusion.directionSelections,
    );
    const report = await fs.readFile(
      path.join(result.directory, 'report.html'),
      'utf8',
    );
    expect(report).toContain('Просадка · только сделки TEST');
    expect(report).toContain('Направления зафиксированы до TEST');
    if (process.env.STRATEGY_RESEARCH_TEST_PREVIEW) {
      const folder = path.join(
        process.env.STRATEGY_RESEARCH_TEST_PREVIEW,
        'long-only',
      );
      await fs.mkdir(folder, { recursive: true });
      for (const file of [
        'report.html',
        'spec.json',
        'result.json',
        'state.json',
        'retention-status.json',
      ])
        await fs.copyFile(
          path.join(result.directory, file),
          path.join(folder, file),
        );
    }
  });
  it('rejects the frozen LONG candidate after a TEST reversal without rescuing it through SHORT', async () => {
    const spec = specFixture('direction-test-reversal');
    const backend = backendFixture();
    const load = backend.loadDataset;
    backend.loadDataset = jest.fn(async (...args) => {
      const data = await load(...args);
      data.trades = data.trades.map((trade) => ({
        ...trade,
        netProfit:
          trade.signalTimestamp >= spec.testSince
            ? trade.direction === 'SHORT'
              ? 100
              : -100
            : trade.direction === 'SHORT'
              ? -5
              : trade.netProfit,
      }));
      data.rows = data.rows.map((row) => ({
        ...row,
        profit: row.direction === 'SHORT' ? -5 : row.profit,
      }));
      return data;
    });
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(result.conclusion.status).toBe('rejected');
    expect(
      result.conclusion.directionSelections.every(
        (item) => item.directions.join(',') === 'LONG',
      ),
    ).toBe(true);
    const primary = result.conclusion.evaluations.find(
      (item) => item.role === 'candidate',
    )!;
    expect(primary.policy.directions).toEqual(['LONG']);
    expect(primary.windows[1].cohorts.SHORT.trades).toBe(0);
    expect(result.state.stages['07-nonfast']).toBeUndefined();
  });
  it('resumes only the failed native stage with its exact saved run id', async () => {
    const spec = specFixture();
    const backend = backendFixture();
    const original = backend.runVariant;
    let failed = false;
    backend.runVariant = jest.fn(async (...args) => {
      if (args[1].id === 'candidate' && !failed) {
        failed = true;
        await args[3]('interrupted-native-id');
        throw new Error('fixture interruption');
      }
      return original(...args);
    });
    await expect(
      runStrategyResearch({ spec, projectRoot: root, backend }),
    ).rejects.toThrow('interruption');
    const directory = path.join(
      root,
      'data/research/strategy',
      spec.core.researchId,
    );
    expect(
      await fs.readFile(path.join(directory, 'report.html'), 'utf8'),
    ).toContain('fixture interruption');
    await runStrategyResearch({ spec, projectRoot: root, backend });
    const retries = jest
      .mocked(backend.runVariant)
      .mock.calls.filter((call) => call[1].id === 'candidate');
    expect(retries[1][4]).toBe('interrupted-native-id');
    expect(
      jest
        .mocked(backend.runVariant)
        .mock.calls.filter((call) => call[1].id === 'control'),
    ).toHaveLength(1);
  });

  it('resolves the shared timestamp-only partition before discovering any filters', async () => {
    const spec = specFixture();
    spec.testSince = 0;
    const backend = backendFixture();
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(backend.selectPartition).toHaveBeenCalledTimes(1);
    expect(result.state.stages['01-partition'].status).toBe('completed');
    const resolved = await readJson<StrategyResearchSpec>(
      path.join(result.directory, 'resolved-spec.json'),
    );
    expect(resolved.testSince).toBeGreaterThan(START);
  });

  it('can confirm an eligible frozen candidate on unopened data without selecting by TEST', async () => {
    const spec = specFixture();
    spec.history = 'unopened';
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend: backendFixture(),
    });
    expect(result.conclusion.status).toBe('candidate-confirmed');
    expect(result.conclusion.selectedId).toBe('own-candidate');
  });
  it('refuses a changed spec, executable lineage and corrupted completed artifacts', async () => {
    const spec = specFixture();
    const backend = backendFixture();
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    await expect(
      runStrategyResearch({
        spec: { ...spec, budget: { ...spec.budget, maxMinutes: 1 } },
        projectRoot: root,
        backend,
      }),
    ).rejects.toThrow('changed');
    const different = {
      ...backend,
      lineage: async () => ({ sourceGitSha: 'new' }),
    };
    await expect(
      runStrategyResearch({ spec, projectRoot: root, backend: different }),
    ).rejects.toThrow('changed');
    await fs.appendFile(
      path.join(result.directory, '03-freeze-gates/result.json'),
      ' ',
    );
    await expect(
      runStrategyResearch({ spec, projectRoot: root, backend }),
    ).rejects.toThrow('artifact changed');
  });
  it('does not discover or retune a frozen candidate on a new period', async () => {
    const first = specFixture();
    const backend = backendFixture();
    const parent = await runStrategyResearch({
      spec: first,
      projectRoot: root,
      backend,
    });
    const newSpec = {
      ...first,
      frozenFrom: first.core.researchId,
      history: 'unopened' as const,
      testSince: END,
      core: {
        ...first.core,
        researchId: 'new-period-fixture',
        window: { ...first.core.window, start: END, end: END + (END - START) },
      },
    };
    const second = await runStrategyResearch({
      spec: newSpec,
      projectRoot: root,
      backend,
    });
    expect(
      await readJson(
        path.join(second.directory, '05-freeze-primary/result.json'),
      ),
    ).toEqual(
      await readJson(
        path.join(parent.directory, '05-freeze-primary/result.json'),
      ),
    );
    expect(
      Object.keys(second.state.stages).some((stage) => stage.startsWith('02-')),
    ).toBe(false);
    expect(
      await readJson(
        path.join(second.directory, '03-freeze-gates/result.json'),
      ),
    ).toEqual(
      await readJson(
        path.join(parent.directory, '03-freeze-gates/result.json'),
      ),
    );
  });
  it('keeps zero-trade compositions visible and never confirms missing support', async () => {
    const spec = specFixture();
    const backend = backendFixture();
    backend.loadDataset = jest.fn(async (_spec, variant) => ({
      variant,
      trades: [],
      rows: [],
      samples: [],
      contextCoverage: {},
      purgedLabels: 0,
    }));
    const result = await runStrategyResearch({
      spec,
      projectRoot: root,
      backend,
    });
    expect(result.conclusion.selectedId).toBeNull();
    expect(result.conclusion.evaluations.map((item) => item.id)).toEqual([
      'baseline',
    ]);
    expect(result.conclusion.directionSelections).toHaveLength(4);
    expect(
      result.conclusion.directionSelections.every(
        (item) => item.directions.length === 0,
      ),
    ).toBe(true);
    expect(
      result.conclusion.evaluations[0].windows[0].cohorts.ALL,
    ).toMatchObject({ trades: 0, pnl: 0, profitFactor: null });
  });
  it('blocks concurrent researchers and paths escaping the Project', async () => {
    await withResearchLock(root, async () => {
      await expect(withResearchLock(root, async () => true)).rejects.toThrow(
        'already running',
      );
    });
    await expect(boundResearchPath(root, '../escaped')).rejects.toThrow(
      'escapes',
    );
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), 'tradejs-outside-'),
    );
    try {
      await fs.symlink(outside, path.join(root, 'link'));
      await expect(boundResearchPath(root, 'link/spec.json')).rejects.toThrow(
        'escapes',
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
  it('does not let future labels influence discovery and blocks portfolio overflow', () => {
    const spec = specFixture();
    const dataset = makeDataset(spec, spec.core.variants[1], true);
    const frozen = discoverResearchGate(spec, dataset);
    const changed = {
      ...dataset,
      rows: [
        ...dataset.rows,
        {
          ...dataset.rows[0],
          timestamp: spec.testSince + 1,
          exitTimestamp: spec.testSince + 2,
          profit: 1e9,
          features: { [feature]: -1e9 },
        },
      ],
    };
    expect(discoverResearchGate(spec, changed).policy).toEqual(frozen.policy);
    const crowded = {
      ...spec,
      portfolio: { maxConcurrentPositions: 1, maxOpenRisk: 10 },
    };
    const result = evaluateResearchComposition({
      spec: crowded,
      dataset,
      id: 'candidate',
      coreId: 'candidate',
      role: 'candidate',
      policy: frozen.policy,
      development: true,
    });
    expect(result.capacity.rejected).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
  });
  it('validates USDT, budgets, immutable risk and required context fields', () => {
    const spec = specFixture();
    expect(() =>
      validateStrategyResearchSpec({
        ...spec,
        budget: { ...spec.budget, maxVariants: 100 },
      }),
    ).toThrow('maxVariants');
    expect(() =>
      validateStrategyResearchSpec({
        ...spec,
        diagnostics: { ...spec.diagnostics, requiredPaths: ['outcome.profit'] },
      }),
    ).toThrow('causal');
    expect(() =>
      validateStrategyResearchSpec({
        ...spec,
        testSince: spec.core.window.end,
      }),
    ).toThrow('testSince');
  });
  it('hides future candles in the decision chart and escapes report text', () => {
    const sample = makeDataset(specFixture(), makeSpec().variants[0], true)
      .samples[0];
    expect(buildResearchCaseSvg(sample, false)).not.toContain('V40');
    expect(buildResearchCaseSvg(sample, true)).not.toEqual(
      buildResearchCaseSvg(sample, false),
    );
    expect(escapeResearchHtml('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
  });
});
