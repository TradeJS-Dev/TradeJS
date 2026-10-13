import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFinalCompositionSpec } from './build-final-composition-spec.mjs';
import { generateFinalCompositionBoard } from './final-composition-board.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  canonicalJson,
  objectSha256,
  sha256,
} from '../../ai-train-local-research/scripts/decision-capture-join.mjs';
import {
  classifyExecutedLabel,
  evaluateFrozenCompositionCriteria,
  executedAxes,
  fieldAvailability,
  deriveExecutedCompositionReport,
  createExecutedSorter,
  FROZEN_COMPOSITION_CRITERIA,
  resolveExecutedSelection,
} from './executed-composition-report.mjs';

const START = 1665273600000,
  END = 1791504000000,
  TAIL = 1740960000000;
const helper = fileURLToPath(
  new URL(
    '../../ai-train-local-research/scripts/decision-capture-storage.mjs',
    import.meta.url,
  ),
);
const reportingStorage = () => ({
  schema: 'tradejs-capture-stream-storage/v1',
  reclaimPlain: false,
  helperSha256: sha256(fs.readFileSync(helper)),
});

export const executedFixture = (
  t,
  {
    trades = [],
    cutoff = TAIL + 100000,
    accepted = true,
    zero = false,
    allow = true,
    id = 'candidate',
    sharedRoot,
    selectionAuthority,
    nativeEmptyStats = false,
  } = {},
) => {
  const root =
    sharedRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'executed-report-'));
  if (!sharedRoot)
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prefix = `${id}-inputs/`;
  fs.mkdirSync(path.join(root, prefix));
  const json = (name, value) => {
    const bytes = canonicalJson(value) + '\n';
    fs.writeFileSync(path.join(root, prefix + name), bytes, { flag: 'wx' });
    return { path: prefix + name, sha256: sha256(bytes) };
  };
  const stream = (name, rows) => {
    const bytes = rows.map((r) => canonicalJson(r) + '\n').join('');
    fs.writeFileSync(path.join(root, `${prefix}${name}.jsonl`), bytes, {
      flag: 'wx',
    });
    return {
      schema: 'tradejs-bounded-jsonl-stream-set/v1',
      status: 'closed',
      rows: rows.length,
      maxRows: 100000,
      maxBytes: 10000000,
      files: [
        {
          path: `${prefix}${name}.jsonl`,
          sha256: sha256(bytes),
          bytes: Buffer.byteLength(bytes),
        },
      ],
    };
  };
  const universe = Array.from({ length: 576 }, (_, n) => `S${n}USDT`);
  const config = { MAX_LOSS_VALUE: 10, BACKTEST_ENTRY_DELAY_BARS: 1 };
  const compositionSpec = json('composition.json', {
    compositionId: 'composition',
    researchRunId: 'research-run',
    sourceConfigSha256: objectSha256(config),
  });
  const bind = {
    researchRunId: 'research-run',
    compositionSha256: compositionSpec.sha256,
    sourceConfigSha256: objectSha256(config),
    strategyName: 'Example',
    configId: 'config',
    symbols: universe,
    windowStart: START,
    windowEnd: END,
  };
  const processReceipt = json('process.json', {
    schema: 'tradejs-research-worker-process-receipt/v1',
    researchRunId: 'research-run',
    sourceConfigSha256: bind.sourceConfigSha256,
    compositionSha256: compositionSpec.sha256,
    nodeVersion: '24.19.0',
    pid: 123,
    ppid: 1,
    rss: 1024,
    comm: 'node',
  });
  const workerObservation = json('worker.json', {
    schema: 'tradejs-research-worker-observation/v1',
    researchRunId: 'research-run',
    sourceConfigSha256: bind.sourceConfigSha256,
    compositionSha256: compositionSpec.sha256,
    pid: 123,
    ppid: 1,
    registrySingleton: true,
    processReceipt,
  });
  const costs = { fees: { maker: 0.001, taker: 0.001 } };
  const tests = universe.map((symbol) => ({
    symbol,
    strategyName: 'Example',
    strategyConfig: config,
    configId: 'config',
    testId: symbol,
    testSuiteId: 'suite',
    executionCosts: costs,
    executionCostsCacheOnly: true,
    ai: true,
    researchTrace: true,
  }));
  const nativeFlags = {
    ai: true,
    jev: false,
    backtestEntryDelayBars: 1,
    backtestPriceMode: 'open',
    cacheOnly: true,
    fast: true,
    ml: false,
    researchTrace: true,
  };
  const contextContract = json('context.json', {
    schema: 'synthetic-context/v1',
    optionalContext: 'unavailable',
  });
  const manifest = json('manifest.json', {
    runId: 'native-run',
    status: 'completed',
    window: { start: START, end: END },
    testSuite: tests,
    flags: nativeFlags,
  });
  const stages = Object.fromEntries(
    [
      'inventory',
      'capture',
      'gate',
      'link',
      'attempt',
      'execution',
      'entryTrace',
      'exitTrace',
    ].map((s) => [s, []]),
  );
  const completed = [];
  for (const [i, tr] of trades.entries()) {
    const identity = {
      symbol: universe[i % 2],
      signalId: `signal-${i}`,
      direction: i % 2 ? 'SHORT' : 'LONG',
      timestamp: tr.decision ?? cutoff + i + 1,
    };
    const signal = { ...identity, strategy: 'Example' },
      payload = { signal },
      invocationId = sha256(String(i));
    const common = { ...identity, ...bind };
    const legacyCommon = { ...common };
    delete legacyCommon.direction;
    stages.inventory.push({
      ...legacyCommon,
      schema: 'tradejs-entry-inventory/v1',
    });
    stages.capture.push({
      ...common,
      schema: 'tradejs-research-decision-capture/v1',
      stage: 'afterEnrichAi/prequeue',
      payload,
      payloadSha256: objectSha256(payload),
      signalSnapshot: signal,
      signalSha256: objectSha256(signal),
    });
    const gate = {
      ...legacyCommon,
      schema: 'tradejs-entry-gate-observation/v1',
      allow,
    };
    stages.gate.push(gate);
    if (!allow) continue;
    for (const [j, [name, stage]] of [
      ['link', 'gate-invocation-link'],
      ['attempt', 'before-place-order-attempt'],
      ['execution', 'after-place-order-executed'],
    ].entries())
      stages[name].push({
        ...common,
        invocationId,
        schema: 'tradejs-entry-execution-observation/v1',
        stage,
        observationSequence: i * 3 + j,
        workerObservationSha256: workerObservation.sha256,
        ...(name === 'link'
          ? { gateObservationSha256: objectSha256(gate) }
          : {}),
      });
    if (tr.unmatchedClosure) {
      if (tr.unmatchedClosure !== true) {
        const entryOnly = tr.unmatchedClosure === 'entry-only';
        stages[entryOnly ? 'entryTrace' : 'exitTrace'].push({
          ...identity,
          timestamp: identity.timestamp,
          invocationId,
          event: entryOnly ? 'entry_executed' : 'position_exited',
          backtestRunId: 'native-run',
          backtestTestKey: identity.symbol,
        });
      }
      continue;
    }
    for (const [name, event] of [
      ['entryTrace', 'entry_executed'],
      ['exitTrace', 'position_exited'],
    ])
      stages[name].push({
        ...identity,
        timestamp:
          name === 'entryTrace'
            ? tr.result?.entryTimestamp === null
              ? null
              : tr.result?.entryTimestamp ?? identity.timestamp
            : tr.exit ?? identity.timestamp + 100,
        invocationId,
        event,
        backtestRunId: 'native-run',
        backtestTestKey: identity.symbol,
      });
    completed.push({
      payload,
      backtestRunId: 'native-run',
      backtestTestKey: identity.symbol,
      tradeResult: {
        netProfit: tr.pnl ?? 1,
        exitTimestamp: tr.exit ?? identity.timestamp + 100,
        entryTimestamp: identity.timestamp,
        qty: 1,
        closedQty: 1,
        entryPrice: 100,
        openFee: 0.1,
        ...(tr.result ?? {}),
      },
    });
  }
  const checkpoint = json(
    'checkpoints.json',
    tests.map((base) => {
      const rows = completed.filter(
        (r) => r.payload.signal.symbol === base.symbol,
      );
      return {
        status: 'success',
        testKey: base.symbol,
        result: {
          test: {
            ...base,
            backtestRunId: 'native-run',
            backtestTestKey: base.symbol,
            chunkId: `${base.symbol}-chunk`,
          },
          stat:
            nativeEmptyStats && rows.length === 0
              ? {
                  amount: 100,
                  profit: 0,
                  orders: 0,
                }
              : {
                  orders: rows.length,
                  wins: rows.filter((r) => r.tradeResult.netProfit > 0).length,
                  losses: rows.filter((r) => r.tradeResult.netProfit < 0)
                    .length,
                  netProfit: rows.reduce(
                    (n, r) => n + r.tradeResult.netProfit,
                    0,
                  ),
                },
        },
      };
    }),
  );
  const mapping = json('mapping.json', {
    schema: 'tradejs-research-backtest-run-binding/v1',
    researchRunId: 'research-run',
    compositionSha256: compositionSpec.sha256,
    backtestRunId: 'native-run',
    manifest,
    completedCheckpoint: checkpoint,
  });
  const artifact = json('authority-part.json', { status: 'synthetic' });
  const a = {
    schema: 'tradejs-executed-composition-authority/v1',
    executionBasis: 'closed-loop-execution',
    metricBasis: 'completed-trade',
    researchId: 'synthetic',
    candidateId: id,
    compositionId: 'composition',
    strategyName: 'Example',
    researchRunId: 'research-run',
    actualBacktestRunId: 'native-run',
    configId: 'config',
    compositionSpec,
    calendar: json('calendar.json', {
      start: START,
      end: END,
      newTailStart: TAIL,
      requestedDays: 1825,
    }),
    gateBoundary: json('boundary.json', { gateCutoff: cutoff }),
    selectionAuthority:
      selectionAuthority ??
      json('selection.json', {
        criteria: FROZEN_COMPOSITION_CRITERIA,
        candidateIds: [id],
        tieBreaker: { orderedTrainCandidateIds: [id] },
      }),
    resolvedConfig: json('config.json', config),
    universe: json('universe.json', universe),
    symbolCohorts: json('cohorts.json', {
      schema: 'tradejs-symbol-cohorts/v1',
      groups: [
        { id: 'full', symbols: universe.slice(0, 120) },
        { id: 'expanded', symbols: universe.slice(120) },
      ],
    }),
    riskUnit: 10,
    entryDelayBars: 1,
    executionCosts: costs,
    nativeFlags,
    contextContract,
    contextContractSha256: contextContract.sha256,
    runBinding: mapping,
    sourceBuildReceipt: json('source-build.json', { node: 'v20.19.6' }),
    sourceBuildNodeVersion: 'v20.19.6',
    operationalRunReceipt: json('operational.json', {
      node: 'v24.19.0',
      contextContractSha256: contextContract.sha256,
      actualBacktestRunId: 'native-run',
    }),
    operationalNodeVersion: 'v24.19.0',
    runtimeCheckpoint: artifact,
    strategyArtifactAuthority: artifact,
    entryNotionalAuthority: artifact,
    reportingStorage: reportingStorage(),
    workerObservations: [workerObservation],
    streams: Object.fromEntries(
      Object.entries(stages).map(([name, rows]) => [name, stream(name, rows)]),
    ),
    completedStream: zero
      ? { status: 'verified-empty', rows: 0, files: [] }
      : stream('completed', completed),
    nativeReconciliation: {
      trades: completed.length,
      wins: completed.filter((r) => r.tradeResult.netProfit > 0).length,
      losses: completed.filter((r) => r.tradeResult.netProfit < 0).length,
      flats: completed.filter((r) => r.tradeResult.netProfit === 0).length,
      pnl: completed.reduce((sum, r) => sum + r.tradeResult.netProfit, 0),
      pnlRoundingBound: 0,
    },
  };
  if (accepted)
    a.executionObservationsAcceptance = json('acceptance.json', {
      schema: 'tradejs-execution-observations-acceptance/v1',
      status: 'ROOT_ACCEPTED',
      compositionSha256: compositionSpec.sha256,
      operationalNodeVersion: 'v24.19.0',
      legacyParityPassed: true,
      storageParityPassed: true,
      bridgeModule: artifact,
      runtimeModule: artifact,
      publicTypes: artifact,
      parityReceipt: artifact,
      rootReview: artifact,
    });
  const validators = {
    ensureRuntimeBuild: async () => ({
      executionRuntime: { checkpoint: artifact, packages: {} },
    }),
    verifyStrategyArtifactAuthority: () => ({}),
    verifyEntryNotionalAuthority: async () => ({
      method: 'fee-derived-full-closed',
      entryFeeRate: 0.001,
      displayPriceDecimals: 8,
      roundingPolicy: { id: 'decimal-half-unit-plus-binary64-interval-v1' },
    }),
    verifyEntryNotionalInputStability: async (value) => value,
  };
  return {
    root,
    authority: a,
    descriptor: json('authority.json', a),
    validators,
    json,
    stream,
    bind,
  };
};

const derive = (fixture, outputPrefix = 'report') =>
  deriveExecutedCompositionReport({
    projectRoot: fixture.root,
    descriptor: fixture.descriptor,
    validators: fixture.validators,
    outputPrefix,
  });

test('gzip-only transport preserves actual matrices, fills and native reconciliation', async (t) => {
  const f = executedFixture(t, { trades: [{ pnl: 3 }, { pnl: -2 }] });
  const plain = await derive(f, 'plain-report');
  for (const stream of [
    ...Object.values(f.authority.streams),
    f.authority.completedStream,
  ]) {
    for (const file of stream.files) {
      const compressed = gzipSync(
        fs.readFileSync(path.join(f.root, file.path)),
      );
      file.path += '.gz';
      fs.writeFileSync(path.join(f.root, file.path), compressed, {
        flag: 'wx',
      });
      file.sha256 = sha256(compressed);
      file.bytes = compressed.length;
    }
  }
  f.descriptor = f.json('gzip-authority.json', f.authority);
  const compressed = await derive(f, 'gzip-report');
  assert.deepEqual(compressed.report.matrices, plain.report.matrices);
  assert.deepEqual(compressed.report.funnel, plain.report.funnel);
  assert.deepEqual(
    compressed.report.nativeReconciliation,
    plain.report.nativeReconciliation,
  );
  assert.deepEqual(
    compressed.report.selectionDecision,
    plain.report.selectionDecision,
  );
});

test('successful own entry without either native closure trace remains explicit UNKNOWN', async (t) => {
  const f = executedFixture(t, { trades: [{}, { unmatchedClosure: true }] });
  const before = fs.readFileSync(
    path.join(f.root, f.authority.streams.execution.files[0].path),
  );
  const { report } = await derive(f);
  assert.equal(report.authorityStatus, 'UNKNOWN');
  assert.equal(report.selectionDecision.status, 'UNKNOWN');
  assert.equal(report.nativeReconciliation.trades, 1);
  assert.equal(report.nativeReconciliation.status, 'MATCH');
  assert.equal(report.funnel.execution, 2);
  assert.equal(report.unmatchedExecutedClosures.count, 1);
  assert.equal(report.unmatchedExecutedClosures.status, 'UNKNOWN');
  assert.equal(
    report.unmatchedExecutedClosures.identities[0].signalId,
    'signal-1',
  );
  assert.equal(report.unmatchedExecutedClosures.identitiesComplete, true);
  assert.deepEqual(
    fs.readFileSync(
      path.join(f.root, f.authority.streams.execution.files[0].path),
    ),
    before,
  );
});

test('one-sided native closure trace is never downgraded to unmatched-entry diagnostics', async (t) => {
  for (const unmatchedClosure of ['entry-only', 'exit-only']) {
    const f = executedFixture(t, { trades: [{}, { unmatchedClosure }] });
    await assert.rejects(
      derive(f),
      /Completed\/execution\/entry\/exit-trace count mismatch|One-sided native closure trace/,
    );
  }
});

test('unmatched successful entry still cannot bypass a false own gate', async (t) => {
  const f = executedFixture(t, { trades: [{}, { unmatchedClosure: true }] });
  const file = path.join(f.root, f.authority.streams.gate.files[0].path);
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  rows[1].allow = false;
  f.authority.streams.gate = f.stream(
    'false-gate-before-extra-execution',
    rows,
  );
  f.descriptor = f.json('false-gate-extra-authority.json', f.authority);
  await assert.rejects(derive(f), /Blocked identity appears downstream/);
});

test('real native empty checkpoint stats bind with mixed fills without input mutation', async (t) => {
  const f = executedFixture(t, { trades: [{}], nativeEmptyStats: true });
  const mapping = JSON.parse(
    fs.readFileSync(path.join(f.root, f.authority.runBinding.path), 'utf8'),
  );
  const file = path.join(f.root, mapping.completedCheckpoint.path);
  const before = fs.readFileSync(file);
  const checkpoint = JSON.parse(before);
  assert.equal(
    checkpoint.filter((e) => Object.keys(e.result.stat).length === 3).length,
    575,
  );
  assert.deepEqual(checkpoint[1].result.stat, {
    amount: 100,
    profit: 0,
    orders: 0,
  });
  const { report } = await derive(f);
  assert.equal(report.nativeReconciliation.trades, 1);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(
    sha256(fs.readFileSync(file)),
    mapping.completedCheckpoint.sha256,
  );
});

test('all genuine native empty stats produce verified zero, not missing-record inference', async (t) => {
  const f = executedFixture(t, {
    zero: true,
    allow: false,
    nativeEmptyStats: true,
  });
  const { report } = await derive(f);
  assert.equal(report.nativeReconciliation.trades, 0);
  assert.equal(report.nativeReconciliation.pnl, 0);
});

test('unsupported or contradictory native zero checkpoint shapes fail closed', async (t) => {
  const invalid = [
    null,
    {},
    { amount: 100, profit: 0 },
    { amount: 100, profit: 0, orders: -1 },
    { amount: 100, profit: 0, orders: 1 },
    { amount: 100, profit: 1, orders: 0 },
    { amount: 101, profit: 0, orders: 0 },
    { amount: 100, profit: 0, orders: 0, wins: 0 },
    { orders: 0, wins: 1, losses: 0, netProfit: 0 },
    { orders: 0, wins: 0, losses: 1, netProfit: 0 },
    { orders: 0, wins: 0, losses: 0, netProfit: 1 },
    { orders: 0, wins: 0, losses: 0, netProfit: 0, profit: 1 },
  ];
  for (const [i, stat] of invalid.entries()) {
    const f = executedFixture(t, { zero: true, id: `bad-native-empty-${i}` });
    const mapping = JSON.parse(
      fs.readFileSync(path.join(f.root, f.authority.runBinding.path), 'utf8'),
    );
    const checkpoint = JSON.parse(
      fs.readFileSync(
        path.join(f.root, mapping.completedCheckpoint.path),
        'utf8',
      ),
    );
    checkpoint[0].result.stat = stat;
    mapping.completedCheckpoint = f.json(
      'invalid-empty-checkpoint.json',
      checkpoint,
    );
    f.authority.runBinding = f.json('invalid-empty-mapping.json', mapping);
    f.descriptor = f.json('invalid-empty-authority.json', f.authority);
    await assert.rejects(
      derive(f),
      /Native checkpoint economic stats unavailable|Invalid native flat count/,
    );
  }
});

test('verified checkpoint runtime is unwrapped for source and notional authorities', async (t) => {
  const f = executedFixture(t, { trades: [{}] });
  const executionRuntime = {
    mode: 'verified-project-runtime-checkpoint',
    checkpoint: f.authority.runtimeCheckpoint,
    packages: { '@tradejs/node': { packageRoot: f.root } },
  };
  f.validators.ensureRuntimeBuild = async () => ({ executionRuntime });
  const seen = [];
  f.validators.verifyStrategyArtifactAuthority = (options) => {
    assert.strictEqual(options.executionRuntime, executionRuntime);
    seen.push('source');
  };
  const verifyNotional = f.validators.verifyEntryNotionalAuthority;
  f.validators.verifyEntryNotionalAuthority = async (options) => {
    assert.strictEqual(options.executionRuntime, executionRuntime);
    seen.push('notional');
    return verifyNotional(options);
  };
  await derive(f);
  assert.deepEqual(seen, ['source', 'notional']);
});

test('checkpoint resolution without nested runtime fails closed before authority checks', async (t) => {
  const f = executedFixture(t, { trades: [{}] });
  f.validators.ensureRuntimeBuild = async () => ({ packages: {} });
  f.validators.verifyStrategyArtifactAuthority = () => {
    assert.fail('Invalid runtime must not reach source verification');
  };
  await assert.rejects(
    derive(f),
    /Missing verified checkpoint execution runtime/,
  );
});
const all = (r, id, basis = 'observed') =>
  [
    ...r.matrices[basis].exitWindow,
    ...r.matrices[basis].decisionPartition,
  ].find(
    (c) =>
      c.id === id &&
      c.symbolGroupId === 'ALL_UNIVERSE' &&
      c.direction === 'ALL',
  );

test('all FAIL and UNKNOWN dispositions never manufacture a best winner', () => {
  const authority = {
    candidateIds: ['baseline', 'a', 'b'],
    baselineSelectionEligible: false,
    tieBreaker: { orderedTrainCandidateIds: ['b', 'a', 'baseline'] },
  };
  const candidates = ['baseline', 'a', 'b'].map((id) => ({
    id,
    role: id === 'baseline' ? 'baseline' : 'candidate',
    selectionDecision: { status: 'FAIL' },
  }));
  assert.deepEqual(resolveExecutedSelection(candidates, authority), {
    selectedId: null,
    finalSelectable: true,
    selectionDisposition: 'no-eligible-composition',
  });
  candidates[1].selectionDecision.status = 'UNKNOWN';
  assert.deepEqual(resolveExecutedSelection(candidates, authority), {
    selectedId: null,
    finalSelectable: false,
    selectionDisposition: 'authority-blocked',
  });
  candidates[1].selectionDecision.status =
    candidates[2].selectionDecision.status = 'PASS';
  assert.equal(resolveExecutedSelection(candidates, authority).selectedId, 'b');
  assert.throws(
    () =>
      resolveExecutedSelection(candidates, { ...authority, selectedId: 'a' }),
    /future selection/,
  );
});

test('actual builder/board retain UNKNOWN diagnostics, empty zero guide, exact 99+99 panels and immutable input', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'executed-board-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preRun = {
    criteria: FROZEN_COMPOSITION_CRITERIA,
    candidateIds: ['baseline', 'candidate'],
    baselineSelectionEligible: false,
    tieBreaker: { orderedTrainCandidateIds: ['candidate', 'baseline'] },
  };
  const bytes = canonicalJson(preRun) + '\n';
  fs.writeFileSync(path.join(root, 'common-selection.json'), bytes);
  const selectionAuthority = {
    path: 'common-selection.json',
    sha256: sha256(bytes),
  };
  const baseline = executedFixture(t, {
    id: 'baseline',
    sharedRoot: root,
    selectionAuthority,
    zero: true,
  });
  const child = executedFixture(t, {
    sharedRoot: root,
    selectionAuthority,
    accepted: false,
    trades: [{ pnl: -2 }],
  });
  const baseResult = await derive(baseline, 'baseline-report');
  const childResult = await derive(child, 'candidate-report');
  const candidate = (id, f, result, current) => ({
    id,
    label: id,
    role: current ? 'baseline' : 'candidate',
    gateSource: current ? 'current' : 'variant',
    color: current ? '#315f7d' : '#d36b2c',
    executedCompositionAuthority: f.descriptor,
    executedCompositionReport: result.reportDescriptor,
    executedCompositionReceipt: result.receiptDescriptor,
  });
  const selection = {
    schema: 'tradejs-final-composition-selection/v1',
    executionBasis: 'closed-loop-execution',
    metricBasis: 'completed-trade',
    strategy: 'Example',
    researchId: 'synthetic',
    title: 'Synthetic actual board',
    subtitle: 'Not actual research',
    baselineId: 'baseline',
    comparisonWindow: { start: START, end: END },
    normalization: { maxLossValue: 10, pnlUnit: 'research PnL' },
    selectionAuthority,
    limitations: ['Synthetic fixtures only'],
    candidates: [
      candidate('baseline', baseline, baseResult, true),
      candidate('candidate', child, childResult, false),
    ],
  };
  const spec = await buildFinalCompositionSpec({
    selection,
    artifactRoot: root,
  });
  assert.equal(spec.selectionDisposition, 'authority-blocked');
  assert.equal(spec.selectedId, null);
  assert.equal(spec.candidates.length, 2);
  const frozen = canonicalJson(spec);
  const output = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: 'charts',
    png: false,
  });
  assert.equal(canonicalJson(spec), frozen);
  const dashboard = fs.readFileSync(
    path.join(root, 'charts/final-composition-dashboard.svg'),
    'utf8',
  );
  const equity = fs.readFileSync(
    path.join(root, 'charts/final-composition-equity.svg'),
    'utf8',
  );
  assert.match(dashboard, /Evaluation blocked/);
  assert.equal([...dashboard.matchAll(/data-cell=/g)].length, 396);
  assert.match(equity, /verified empty; zero guide is not observed equity/);
  assert.ok(!equity.includes('data-observed-equity="baseline"'));
  assert.equal(output.summary.finalSelectable, false);
  assert.equal(output.summary.selectedId, null);
  await assert.rejects(
    generateFinalCompositionBoard({
      spec,
      artifactRoot: root,
      outDir: 'charts',
      png: false,
    }),
    /EEXIST/,
  );
});

test('99 observed cells and 99 stress cells use independent calendar and decision axes', () => {
  const axes = executedAxes({
    start: 1665273600000,
    end: 1791504000000,
    gateCutoff: 1750000000000,
    newTailStart: 1740960000000,
  });
  assert.equal(axes.length, 99);
  assert.equal(axes.filter((c) => c.axis === 'exit-window').length, 72);
  assert.equal(axes.filter((c) => c.axis === 'decision-partition').length, 27);
});

test('DEV maturity, final TEST and independently overlapping new tail are distinct', () => {
  const time = { start: 1, end: 1000, gateCutoff: 500, newTailStart: 400 };
  assert.equal(
    classifyExecutedLabel(450, 499, time).primary,
    'OUTER_DEV_FROZEN',
  );
  assert.equal(classifyExecutedLabel(450, 500, time).devCrossing, true);
  assert.equal(
    classifyExecutedLabel(500, 999, time).primary,
    'OUTER_TEST_FROZEN',
  );
  assert.equal(classifyExecutedLabel(500, 1000, time).exactEnd, true);
  assert.equal(
    classifyExecutedLabel(450, 499, time).newTailIntersection,
    'DEV',
  );
  assert.equal(
    classifyExecutedLabel(500, 999, time).newTailIntersection,
    'TEST',
  );
  assert.equal(
    classifyExecutedLabel(450, 499, { ...time, gateCutoff: null }).primary,
    null,
  );
  assert.throws(() => classifyExecutedLabel(500, 499, time), /causal order/);
});

test('missing, explicit null, invalid and unsupported never become zero', () => {
  assert.equal(fieldAvailability({}, 'qty', Number.isFinite), 'missing');
  assert.equal(
    fieldAvailability({ qty: null }, 'qty', Number.isFinite),
    'explicit-null',
  );
  assert.equal(
    fieldAvailability({ qty: '2' }, 'qty', Number.isFinite),
    'invalid',
  );
  assert.equal(
    fieldAvailability({ qty: 2 }, 'qty', Number.isFinite, false),
    'unsupported',
  );
});

test('UNKNOWN is retained even when another economic criterion fails', () => {
  const observed = {
    authorityStatus: 'UNKNOWN',
    profitFactor: 0.4,
    pnl: -20,
    completedEvents: 2,
    cadencePerDay: 0.01,
    maxDrawdown: 20,
    maxLossStreak: 8,
  };
  const result = evaluateFrozenCompositionCriteria(observed, observed);
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.rules.some((r) => r.status === 'FAIL'));
  assert.ok(result.rules.some((r) => r.status === 'UNKNOWN'));
});

test('complete chain uses own actual fills, 99+99 cells and grouped simultaneous exits', async (t) => {
  const f = executedFixture(t, {
    trades: [
      { pnl: -10, exit: TAIL + 200000 },
      { pnl: 10, exit: TAIL + 200000 },
      { pnl: 0, exit: TAIL + 200001 },
    ],
  });
  const { report, receipt } = await derive(f);
  const cell = all(report, 'FULL_1461D');
  assert.equal(cell.trades, 3);
  assert.equal(cell.maxDrawdown, 0);
  assert.equal(cell.flats, 1);
  assert.equal(cell.maxLossStreak, 1);
  assert.equal(cell.completedEvents, 3);
  assert.equal(cell.pnl, 0);
  assert.equal(
    all(report, 'FULL_1461D', 'stress20bps').pnl,
    -10 - 0.2 + (10 - 0.2) + (0 - 0.2),
  );
  assert.equal(report.equity.rows, 2);
  assert.equal(report.resources.wholePayloadsRetained, 0);
  assert.equal(receipt.inputStabilityVerified, true);
  assert.equal(report.selectionDecision.status, 'FAIL');
  assert.equal(cell.p05Profit, -10);
  assert.equal(cell.p95Profit, 10);
});

test('verified all-block zero creates no export requirement and no equity shard', async (t) => {
  const f = executedFixture(t, { trades: [{}, {}], zero: true, allow: false });
  const { report } = await derive(f);
  assert.deepEqual(report.equity, {
    status: 'verified-empty',
    stream: null,
    rows: 0,
  });
  assert.equal(all(report, 'FULL_1461D').pnl, 0);
  assert.equal(all(report, 'FULL_1461D').profitFactor, null);
  assert.equal(all(report, 'FULL_1461D').winRate, null);
  assert.equal(report.funnel.blocked, 2);
  assert.equal(report.selectionDecision.status, 'FAIL');
  assert.ok(
    !fs.readdirSync(f.root).some((name) => name.startsWith('report.equity')),
  );
});

test('DEV crossings remain diagnostic; exact-END native rows never enter economics', async (t) => {
  const cutoff = TAIL + 100000;
  const f = executedFixture(t, {
    cutoff,
    trades: [
      { decision: cutoff - 2, exit: cutoff - 1 },
      { decision: cutoff - 1, exit: cutoff },
      { decision: cutoff, exit: END - 1 },
      { decision: cutoff + 1, exit: END },
    ],
  });
  const { report } = await derive(f);
  assert.equal(report.nativeReconciliation.trades, 4);
  assert.equal(all(report, 'FULL_1461D').trades, 3);
  assert.equal(all(report, 'OUTER_DEV_FROZEN').trades, 1);
  assert.equal(all(report, 'OUTER_TEST_FROZEN').trades, 1);
  assert.equal(all(report, 'NEW_TAIL_DIAGNOSTIC').trades, 3);
  assert.equal(report.crossing.devCrossingGateCutoffCompletedDiagnostic, 1);
  assert.equal(report.crossing.exitAtFrozenEndNativeOnly, 1);
});

test('missing bridge authority preserves diagnostics and UNKNOWN, not economic FAIL', async (t) => {
  const f = executedFixture(t, { accepted: false, trades: [{ pnl: -2 }] });
  const { report, receipt } = await derive(f);
  assert.equal(all(report, 'FULL_1461D').pnl, -2);
  assert.equal(report.selectionDecision.status, 'UNKNOWN');
  assert.equal(receipt.acceptedForActualUse, false);
  assert.ok(report.blockers.includes('missing-accepted-opt-in-bridge-parity'));
});

test('default stress uses existing actual-entry notional without optional fee authority', async (t) => {
  const f = executedFixture(t, {
    accepted: false,
    trades: [
      {
        pnl: 1,
        result: { entryPrice: 100, qty: 2, closedQty: 1, openFee: null },
      },
    ],
  });
  delete f.authority.entryNotionalAuthority;
  f.descriptor = f.json('authority-default-stress.json', f.authority);
  const before = fs.readFileSync(
    path.join(f.root, f.authority.completedStream.files[0].path),
  );
  const { report } = await derive(f);
  assert.equal(all(report, 'FULL_1461D', 'stress20bps').pnl, 0.8);
  assert.equal(
    all(report, 'FULL_1461D', 'stress20bps').economicCompletenessStatus,
    'COMPLETE',
  );
  assert.equal(report.authorityStatus, 'UNKNOWN');
  assert.deepEqual(
    fs.readFileSync(
      path.join(f.root, f.authority.completedStream.files[0].path),
    ),
    before,
  );
});

test('default stress retains UNKNOWN for missing or invalid actual notional fields', async (t) => {
  for (const result of [
    { entryPrice: null },
    { closedQty: 2, qty: 1 },
    { entryPrice: -100 },
    { entryPrice: 1e308, qty: 1e308, closedQty: 1e308 },
  ]) {
    const f = executedFixture(t, { trades: [{ result }] });
    delete f.authority.entryNotionalAuthority;
    f.descriptor = f.json('authority-default-stress.json', f.authority);
    const { report } = await derive(f);
    assert.equal(all(report, 'FULL_1461D', 'stress20bps').pnl, null);
    assert.equal(
      all(report, 'FULL_1461D', 'stress20bps').economicCompletenessStatus,
      'UNKNOWN',
    );
  }
});

test('missing actual fee only blocks affected stress cells, without displayed-price fallback', async (t) => {
  const f = executedFixture(t, { trades: [{ result: { openFee: null } }] });
  const { report } = await derive(f);
  assert.equal(all(report, 'FULL_1461D').pnl, 1);
  assert.equal(all(report, 'FULL_1461D', 'stress20bps').pnl, null);
  assert.equal(
    report.fieldAvailability['completed.openFee']['explicit-null'],
    1,
  );
  assert.equal(
    report.matrices.stress20bps.exitWindow.find(
      (c) => c.id === 'FULL_1461D' && c.direction === 'SHORT',
    ).authorityStatus,
    'COMPLETE',
  );
});

test('checksum tamper fails before economic input and never becomes verified zero', async (t) => {
  const f = executedFixture(t, { zero: true });
  fs.appendFileSync(path.join(f.root, f.authority.resolvedConfig.path), ' ');
  await assert.rejects(derive(f), /checksum mismatch/);
});

test('blocked identity injected into downstream stages fails own-fill proof', async (t) => {
  const f = executedFixture(t, { zero: true, allow: false, trades: [{}] });
  const row = {
    schema: 'tradejs-entry-execution-observation/v1',
    stage: 'gate-invocation-link',
    symbol: 'S0USDT',
    signalId: 'signal-0',
    direction: 'LONG',
    timestamp: TAIL + 100001,
    ...f.bind,
    invocationId: sha256('0'),
    observationSequence: 0,
    workerObservationSha256: f.authority.workerObservations[0].sha256,
    gateObservationSha256: sha256('injected'),
  };
  f.authority.streams.link = f.stream('injected-link', [row]);
  f.descriptor = f.json('authority-mutated.json', f.authority);
  await assert.rejects(derive(f), /Blocked identity/);
});

test('external compact sort spills under fixed logical bounds and preserves exact ordering', async (t) => {
  const f = executedFixture(t, { zero: true });
  const sorter = createExecutedSorter({
    projectRoot: f.root,
    outputPath: 'forced-sort',
    authority: f.bind,
    storage: reportingStorage(),
    limits: { maxSortBytes: 1024, fanIn: 2 },
  });
  for (let i = 100; i > 0; i--) await sorter.append([i], { amount: i });
  const result = await sorter.close();
  assert.ok(result.resources.peakLogicalSortBytes <= 1024);
  assert.ok(result.resources.maxMergeHeads <= 2);
  assert.equal(result.resources.wholePayloadsRetained, 0);
  assert.ok(result.descriptor);
});

test('partial holding data stays null; decision funnels retain side/cohort membership', async (t) => {
  const f = executedFixture(t, {
    trades: [{ result: { entryTimestamp: null } }, {}],
  });
  const { report } = await derive(f);
  assert.equal(all(report, 'FULL_1461D').p50HoldingHours, null);
  assert.equal(
    all(report, 'FULL_1461D').holdingHoursStatus,
    'UNKNOWN-missing-actual-entry-timestamp',
  );
  const testAll = report.decisionFunnel.find(
    (c) =>
      c.id === 'OUTER_TEST_FROZEN' &&
      c.symbolGroupId === 'ALL_UNIVERSE' &&
      c.direction === 'ALL',
  );
  assert.equal(testAll.allowed, 2);
  assert.equal(testAll.execution, 2);
  assert.equal(
    report.decisionFunnel.find(
      (c) =>
        c.id === 'OUTER_TEST_FROZEN' &&
        c.symbolGroupId === 'COHORT_456' &&
        c.direction === 'ALL',
    ).execution,
    0,
  );
});

test('reversed parallel stage ordering is rejected, without editing legacy gate bytes', async (t) => {
  const f = executedFixture(t, { trades: [{}] });
  const ref = f.authority.streams.attempt.files[0];
  const row = JSON.parse(fs.readFileSync(path.join(f.root, ref.path), 'utf8'));
  row.observationSequence = 0;
  f.authority.streams.attempt = f.stream('reversed-attempt', [row]);
  f.descriptor = f.json('reversed-authority.json', f.authority);
  await assert.rejects(derive(f), /earlier invocation link/);
});

test('foreign symlink cannot supply an authority descriptor', async (t) => {
  const f = executedFixture(t, { zero: true });
  fs.symlinkSync('/etc/hosts', path.join(f.root, 'foreign.json'));
  f.authority.calendar = {
    path: 'foreign.json',
    sha256: sha256(fs.readFileSync('/etc/hosts')),
  };
  f.descriptor = f.json('foreign-authority.json', f.authority);
  await assert.rejects(derive(f), /Project|symlink|root/i);
});

test('actual blocked own gate link is valid diagnostic coverage, never a fill', async (t) => {
  const f = executedFixture(t, { zero: true, allow: false, trades: [{}] });
  const gate = JSON.parse(
    fs.readFileSync(
      path.join(f.root, f.authority.streams.gate.files[0].path),
      'utf8',
    ),
  );
  const row = {
    ...gate,
    direction: 'LONG',
    schema: 'tradejs-entry-execution-observation/v1',
    stage: 'gate-invocation-link',
    ownGateCalled: true,
    invocationId: sha256('0'),
    observationSequence: 0,
    workerObservationSha256: f.authority.workerObservations[0].sha256,
    gateObservationSha256: objectSha256(gate),
  };
  f.authority.streams.link = f.stream('blocked-link', [row]);
  f.descriptor = f.json('blocked-authority.json', f.authority);
  const { report } = await derive(f);
  assert.equal(report.funnel.blocked, 1);
  assert.equal(report.funnel.link, 1);
  assert.equal(report.funnel.execution, 0);
  assert.equal(report.equity.status, 'verified-empty');
});

test('shared mixed hook stream is stage-selected; prior veto never invents own coverage', async (t) => {
  const f = executedFixture(t, { trades: [{}] });
  const rows = ['link', 'attempt', 'execution'].map((s) =>
    JSON.parse(
      fs.readFileSync(
        path.join(f.root, f.authority.streams[s].files[0].path),
        'utf8',
      ),
    ),
  );
  rows.push({
    ...rows[0],
    signalId: 'prior-veto',
    ownGateCalled: false,
    priorManifestVeto: true,
    allow: false,
    gateObservationSha256: null,
    observationSequence: 3,
  });
  const mixed = f.stream('mixed-hooks', rows);
  for (const [name, stage] of [
    ['link', 'gate-invocation-link'],
    ['attempt', 'before-place-order-attempt'],
    ['execution', 'after-place-order-executed'],
  ])
    f.authority.streams[name] = { ...mixed, stage };
  f.descriptor = f.json('mixed-authority.json', f.authority);
  const { report } = await derive(f);
  assert.equal(report.funnel.priorManifestVetoWithoutOwnGate, 1);
  assert.equal(report.funnel.link, 1);
  assert.equal(report.funnel.allowed, 1);
  assert.equal(report.nativeReconciliation.trades, 1);
});

test('trace funnel uses original decision, not delayed entry or exit clocks', async (t) => {
  const cutoff = TAIL + 100000;
  const f = executedFixture(t, {
    cutoff,
    trades: [
      {
        decision: cutoff - 10,
        exit: cutoff + 10,
        result: { entryTimestamp: cutoff + 1 },
      },
    ],
  });
  const { report } = await derive(f);
  const cell = (id) =>
    report.decisionFunnel.find(
      (c) =>
        c.id === id &&
        c.symbolGroupId === 'ALL_UNIVERSE' &&
        c.direction === 'ALL',
    );
  assert.equal(cell('OUTER_DEV_FROZEN').entryTrace, 1);
  assert.equal(cell('OUTER_TEST_FROZEN').entryTrace, 0);
  assert.equal(cell('OUTER_DEV_FROZEN').exitTrace, 1);
  assert.equal(report.crossing.devCrossingGateCutoffCompletedDiagnostic, 1);
});

test('native per-test cost and linked secret-free process proof fail closed when changed', async (t) => {
  const f = executedFixture(t, { zero: true });
  const worker = JSON.parse(
    fs.readFileSync(
      path.join(f.root, f.authority.workerObservations[0].path),
      'utf8',
    ),
  );
  const processProof = JSON.parse(
    fs.readFileSync(path.join(f.root, worker.processReceipt.path), 'utf8'),
  );
  processProof.nodeVersion = '20.19.6';
  worker.processReceipt = f.json('wrong-process.json', processProof);
  f.authority.workerObservations = [f.json('wrong-worker.json', worker)];
  f.descriptor = f.json('wrong-worker-authority.json', f.authority);
  await assert.rejects(derive(f), /process\/Node receipt/);
});
