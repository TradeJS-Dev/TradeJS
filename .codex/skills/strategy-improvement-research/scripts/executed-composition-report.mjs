#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  boundPath,
  canonicalJson,
  hashFile,
  objectSha256,
  scanJsonLines,
  validateCapture,
  verifyCompletedRunBinding,
  writeExclusiveJson,
} from '../../ai-train-local-research/scripts/decision-capture-join.mjs';
import {
  boundedHash,
  createDiskIdentityIndex,
  createShardedCaptureSink,
  readBoundedFile,
  readStorageManifest,
  storageLimits,
} from '../../ai-train-local-research/scripts/decision-capture-storage.mjs';
import {
  deriveFeeEntryStressNotional,
  getEntryStressNotional,
  ensureRuntimeBuild,
  normalizeSymbolCohorts,
  verifyEntryNotionalAuthority,
  verifyEntryNotionalInputStability,
  verifyStrategyArtifactAuthority,
} from '../../ai-train-local-research/scripts/ai-gate-ablation.mjs';

const DAY = 86400000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const integer = Number.isSafeInteger;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const demand = (condition, message) => {
  if (!condition) throw new Error(message);
};
const SHA = /^[a-f0-9]{64}$/u;
const SELF = fileURLToPath(import.meta.url);
export const FROZEN_COMPOSITION_CRITERIA = Object.freeze({
  profitFactorMin: 1.1,
  pnlStrictlyPositive: true,
  completedEventsMin: 50,
  cadencePerDayMin: 0.075,
  maxDrawdownMax: 100,
  maxLossStreakMax: 4,
  stress20bps: { pnlMin: -100, profitFactorMin: 0.8, maxDrawdownMax: 150 },
});
const DIRECTIONS = ['ALL', 'LONG', 'SHORT'];
const GROUPS = ['ALL_UNIVERSE', 'COHORT_120', 'COHORT_456'];
const TERMINALS = [1460, 1095, 365, 180, 90, 30, 7];

export const fieldAvailability = (
  row,
  field,
  valid = () => true,
  supported = true,
) => {
  if (!supported) return 'unsupported';
  if (!Object.hasOwn(row, field)) return 'missing';
  if (row[field] === null) return 'explicit-null';
  return valid(row[field]) ? 'present' : 'invalid';
};

export const classifyExecutedLabel = (decision, exit, time) => {
  if (!integer(decision) || !integer(exit))
    return { status: 'UNKNOWN', primary: null, newTailIntersection: null };
  demand(exit >= decision, 'Invalid causal order: exit precedes decision');
  const inWindow = decision >= time.start && decision < time.end;
  const cutoffKnown =
    integer(time.gateCutoff) &&
    time.gateCutoff > time.start &&
    time.gateCutoff < time.end;
  const dev = inWindow && cutoffKnown && decision < time.gateCutoff;
  const test = inWindow && cutoffKnown && decision >= time.gateCutoff;
  const exactEnd = exit === time.end;
  const beyond = exit > time.end || decision >= time.end;
  const economic = inWindow && exit < time.end;
  const newTail = inWindow && decision >= time.newTailStart;
  return {
    status: cutoffKnown ? 'COMPLETE' : 'UNKNOWN',
    primary:
      economic && dev && exit < time.gateCutoff
        ? 'OUTER_DEV_FROZEN'
        : economic && test
          ? 'OUTER_TEST_FROZEN'
          : null,
    assigned: dev ? 'DEV' : test ? 'TEST' : null,
    devCrossing: economic && dev && exit >= time.gateCutoff,
    exactEnd,
    beyond,
    economic,
    newTail,
    newTailIntersection: newTail ? (dev ? 'DEV' : test ? 'TEST' : null) : null,
  };
};

export const executedAxes = (time) => {
  const windows = [
    { id: 'FULL_1461D', start: time.start, end: time.end, axis: 'exit-window' },
    ...TERMINALS.map((days) => ({
      id: `LAST_${days}D`,
      start: Math.max(time.start, time.end - days * DAY),
      end: time.end,
      axis: 'exit-window',
    })),
    {
      id: 'OUTER_DEV_FROZEN',
      start: time.start,
      end: time.gateCutoff,
      axis: 'decision-partition',
    },
    {
      id: 'OUTER_TEST_FROZEN',
      start: time.gateCutoff,
      end: time.end,
      axis: 'decision-partition',
    },
    {
      id: 'NEW_TAIL_DIAGNOSTIC',
      start: time.newTailStart,
      end: time.end,
      axis: 'decision-partition',
    },
  ];
  return windows.flatMap((window) =>
    GROUPS.flatMap((symbolGroupId) =>
      DIRECTIONS.map((direction) => ({
        ...window,
        symbolGroupId,
        direction,
        days:
          integer(window.start) && integer(window.end)
            ? (window.end - window.start) / DAY
            : null,
      })),
    ),
  );
};

export const evaluateFrozenCompositionCriteria = (
  observed,
  stress,
  criteria = FROZEN_COMPOSITION_CRITERIA,
  blockers = [],
) => {
  demand(
    same(criteria, FROZEN_COMPOSITION_CRITERIA),
    'Frozen criteria changed',
  );
  const rules = [];
  const add = (id, value, pass, denominatorStatus) =>
    rules.push({
      id,
      value: value ?? null,
      status: !finite(value)
        ? ['no-support', 'no-losses'].includes(denominatorStatus)
          ? 'FAIL'
          : 'UNKNOWN'
        : pass(value)
          ? 'PASS'
          : 'FAIL',
    });
  rules.push({
    id: 'authority',
    value: observed?.authorityStatus ?? null,
    status:
      observed?.authorityStatus === 'COMPLETE' && !blockers.length
        ? 'PASS'
        : 'UNKNOWN',
  });
  add(
    'test-profit-factor',
    observed?.profitFactor,
    (v) => v >= criteria.profitFactorMin,
    observed?.profitFactorStatus,
  );
  add('test-positive-pnl', observed?.pnl, (v) => v > 0);
  add(
    'test-completed-events',
    observed?.completedEvents,
    (v) => v >= criteria.completedEventsMin,
  );
  add(
    'test-cadence',
    observed?.cadencePerDay,
    (v) => v >= criteria.cadencePerDayMin,
  );
  add(
    'test-max-drawdown',
    observed?.maxDrawdown,
    (v) => v <= criteria.maxDrawdownMax,
  );
  add(
    'test-loss-streak',
    observed?.maxLossStreak,
    (v) => v <= criteria.maxLossStreakMax,
  );
  rules.push({
    id: 'stress-authority',
    value: stress?.authorityStatus ?? null,
    status: stress?.authorityStatus === 'COMPLETE' ? 'PASS' : 'UNKNOWN',
  });
  add(
    'stress-positive-bound',
    stress?.pnl,
    (v) => v >= criteria.stress20bps.pnlMin,
  );
  add(
    'stress-profit-factor',
    stress?.profitFactor,
    (v) => v >= criteria.stress20bps.profitFactorMin,
    stress?.profitFactorStatus,
  );
  add(
    'stress-max-drawdown',
    stress?.maxDrawdown,
    (v) => v <= criteria.stress20bps.maxDrawdownMax,
  );
  return {
    cell: 'OUTER_TEST_FROZEN/ALL_UNIVERSE/ALL',
    status: rules.some((r) => r.status === 'UNKNOWN')
      ? 'UNKNOWN'
      : rules.some((r) => r.status === 'FAIL')
        ? 'FAIL'
        : 'PASS',
    rules,
    blockers,
  };
};

// Metadata is small and explicitly bounded. Economic streams are never read here.
export const readExecutedDescriptor = async (
  projectRoot,
  descriptor,
  maxBytes = 16777216,
) => {
  demand(
    descriptor && SHA.test(descriptor.sha256 ?? ''),
    'Checksum-bound descriptor required',
  );
  const file = boundPath(projectRoot, descriptor.path);
  const value = await boundedHash(file, maxBytes);
  demand(value.sha256 === descriptor.sha256, 'Descriptor checksum mismatch');
  return {
    descriptor: {
      path: descriptor.path,
      sha256: value.sha256,
      bytes: value.bytes,
    },
    file,
    value: JSON.parse(readBoundedFile(file, maxBytes)),
  };
};

export const verifyExecutedCompositionAuthority = async ({
  projectRoot,
  descriptor,
  validators = {},
}) => {
  projectRoot = fs.realpathSync(projectRoot);
  const input = await readExecutedDescriptor(projectRoot, descriptor);
  const a = input.value;
  demand(
    a.schema === 'tradejs-executed-composition-authority/v1' &&
      a.executionBasis === 'closed-loop-execution' &&
      a.metricBasis === 'completed-trade',
    'Executed authority schema/basis mismatch',
  );
  for (const key of [
    'researchId',
    'candidateId',
    'compositionId',
    'strategyName',
    'researchRunId',
    'actualBacktestRunId',
    'configId',
  ])
    demand(typeof a[key] === 'string' && a[key], `Missing authority ${key}`);
  const checked = [input];
  const load = async (name) => {
    const item = await readExecutedDescriptor(projectRoot, a[name]);
    checked.push(item);
    return item.value;
  };
  const composition = await load('compositionSpec');
  const calendar = await load('calendar');
  const boundary = await load('gateBoundary');
  const selection = await load('selectionAuthority');
  const config = await load('resolvedConfig');
  const universe = await load('universe');
  const cohorts = normalizeSymbolCohorts(await load('symbolCohorts'));
  demand(
    integer(calendar.start) &&
      integer(calendar.end) &&
      calendar.end > calendar.start &&
      (calendar.end - calendar.start) / DAY === 1461 &&
      calendar.requestedDays === 1825,
    'Exact requested/covered calendar required',
  );
  demand(
    a.riskUnit === 10 && config.MAX_LOSS_VALUE === 10,
    'Research risk must be 10',
  );
  demand(
    Array.isArray(universe) &&
      universe.length === 576 &&
      new Set(universe).size === 576 &&
      universe.every((s) => typeof s === 'string' && s),
    'Exact ordered 576 universe required',
  );
  demand(
    cohorts.groups.length === 2 &&
      cohorts.groups[0].symbols.length === 120 &&
      cohorts.groups[1].symbols.length === 456 &&
      cohorts.groups
        .flatMap((g) => g.symbols)
        .every((s) => universe.includes(s)),
    'Exact disjoint120/456 union required',
  );
  demand(
    composition.compositionId === a.compositionId &&
      composition.researchRunId === a.researchRunId &&
      composition.sourceConfigSha256 === objectSha256(config),
    'Composition identity/config mismatch',
  );
  demand(
    same(selection.criteria, FROZEN_COMPOSITION_CRITERIA),
    'Frozen selection criteria mismatch',
  );
  demand(
    !['selectedId', 'statuses', 'metrics'].some((k) =>
      Object.hasOwn(selection, k),
    ) &&
      Array.isArray(selection.candidateIds) &&
      selection.candidateIds.includes(a.candidateId),
    'Pre-run selection cannot contain future outcomes',
  );
  const blockers = [];
  if (!integer(boundary.gateCutoff))
    blockers.push('uncomputed-common-gate-cutoff');
  else
    demand(
      boundary.gateCutoff > calendar.start &&
        boundary.gateCutoff < calendar.end,
      'Cutoff outside calendar',
    );
  const time = {
    start: calendar.start,
    end: calendar.end,
    gateCutoff: boundary.gateCutoff ?? null,
    newTailStart: calendar.newTailStart,
  };
  demand(
    integer(time.newTailStart) &&
      time.newTailStart >= time.start &&
      time.newTailStart < time.end,
    'Independent new-tail calendar required',
  );
  const bind = {
    researchRunId: a.researchRunId,
    compositionSha256: a.compositionSpec.sha256,
    strategyName: a.strategyName,
    configId: a.configId,
    sourceConfigSha256: objectSha256(config),
    symbols: universe,
    windowStart: time.start,
    windowEnd: time.end,
  };
  const mapping = (
    validators.verifyCompletedRunBinding ?? verifyCompletedRunBinding
  )(projectRoot, a.runBinding, bind);
  demand(
    mapping.actualBacktestRunId === a.actualBacktestRunId,
    'Actual run mismatch',
  );
  for (let i = 0; i < mapping.files.length; i++)
    checked.push({
      file: mapping.files[i],
      descriptor: {
        path: path.relative(projectRoot, mapping.files[i]),
        sha256: mapping.expectedHashes[i],
      },
    });
  const runMapping = await readExecutedDescriptor(projectRoot, a.runBinding);
  const manifest = await readExecutedDescriptor(
    projectRoot,
    runMapping.value.manifest,
  );
  const checkpoint = await readExecutedDescriptor(
    projectRoot,
    runMapping.value.completedCheckpoint,
  );
  const expectedBySymbol = new Map();
  for (const entry of checkpoint.value) {
    const rawStat = entry.result.stat;
    // Native TestConnector.getResult returns this exact short form when its
    // closed position log is empty. Recognize that documented zero locally;
    // never rewrite the checksum-bound checkpoint or infer absent records.
    const nativeEmpty =
      rawStat &&
      same(Object.keys(rawStat).sort(), ['amount', 'orders', 'profit']) &&
      rawStat.amount === 100 &&
      rawStat.orders === 0 &&
      rawStat.profit === 0;
    const stat = nativeEmpty
      ? { orders: 0, wins: 0, losses: 0, netProfit: 0 }
      : rawStat;
    demand(
      stat &&
        ['orders', 'wins', 'losses'].every(
          (k) => integer(stat[k]) && stat[k] >= 0,
        ) &&
        finite(stat.netProfit),
      'Native checkpoint economic stats unavailable',
    );
    demand(
      stat.orders !== 0 ||
        (stat.wins === 0 &&
          stat.losses === 0 &&
          stat.netProfit === 0 &&
          (!Object.hasOwn(rawStat, 'profit') || rawStat.profit === 0)),
      'Native checkpoint economic stats unavailable',
    );
    demand(stat.wins + stat.losses <= stat.orders, 'Invalid native flat count');
    expectedBySymbol.set(entry.result.test.symbol, {
      trades: stat.orders,
      wins: stat.wins,
      losses: stat.losses,
      flats: stat.orders - stat.wins - stat.losses,
      pnl: stat.netProfit,
    });
  }
  demand(
    a.nativeReconciliation?.pnlRoundingBound >= 0 &&
      a.nativeReconciliation.pnlRoundingBound <= universe.length * 0.005,
    'Native rounding bound exceeds per-symbol cent rounding',
  );
  demand(
    same(
      manifest.value.testSuite.map((t) => t.symbol),
      universe,
    ),
    'Manifest ordered universe mismatch',
  );
  const requiredFlags = {
    cacheOnly: true,
    ai: true,
    researchTrace: true,
    backtestEntryDelayBars: a.entryDelayBars,
  };
  demand(
    Object.entries(requiredFlags).every(
      ([key, value]) => manifest.value.flags?.[key] === value,
    ),
    'Native required flags unavailable or unequal',
  );
  demand(
    a.nativeFlags && same(manifest.value.flags, a.nativeFlags),
    'Exact frozen native flags must include optional flags',
  );
  demand(
    manifest.value.testSuite.every(
      (test) =>
        same(test.executionCosts, a.executionCosts) &&
        test.executionCostsCacheOnly === true &&
        test.ai === true &&
        test.researchTrace === true &&
        test.strategyConfig.BACKTEST_ENTRY_DELAY_BARS === a.entryDelayBars,
    ),
    'Per-test actual costs/cache/trace/delay unavailable or unequal',
  );
  demand(a.entryDelayBars === 1, 'Frozen entry delay required');
  const sourceBuild = await load('sourceBuildReceipt');
  const operational = await load('operationalRunReceipt');
  demand(
    sourceBuild.node === a.sourceBuildNodeVersion &&
      operational.node === a.operationalNodeVersion,
    'Node version must match its own receipt role',
  );
  await load('contextContract');
  demand(
    a.contextContract.sha256 === a.contextContractSha256 &&
      operational.contextContractSha256 === a.contextContractSha256 &&
      operational.actualBacktestRunId === a.actualBacktestRunId,
    'Context contract must bind its actual operational receipt, not an invented manifest field',
  );
  let executionRuntime = null;
  let entryNotional = null;
  if (a.runtimeCheckpoint && a.strategyArtifactAuthority) {
    await load('runtimeCheckpoint');
    await load('strategyArtifactAuthority');
    const resolvedRuntime = await (
      validators.ensureRuntimeBuild ?? ensureRuntimeBuild
    )(a.frameworkRepositoryRoot, {
      projectRoot,
      runtimeCheckpoint: a.runtimeCheckpoint.path,
    });
    executionRuntime = resolvedRuntime?.executionRuntime;
    demand(
      executionRuntime && typeof executionRuntime === 'object',
      'Missing verified checkpoint execution runtime',
    );
    (
      validators.verifyStrategyArtifactAuthority ??
      verifyStrategyArtifactAuthority
    )({
      sourceRepositoryRoot: a.sourceRepositoryRoot,
      projectRoot,
      strategyArtifactAuthority: a.strategyArtifactAuthority.path,
      executionRuntime,
    });
  } else blockers.push('missing-runtime-or-compiled-source-authority');
  if (a.executionObservationsAcceptance) {
    const acceptance = await load('executionObservationsAcceptance');
    demand(
      acceptance.schema === 'tradejs-execution-observations-acceptance/v1' &&
        acceptance.status === 'ROOT_ACCEPTED' &&
        acceptance.compositionSha256 === a.compositionSpec.sha256 &&
        acceptance.operationalNodeVersion === a.operationalNodeVersion &&
        acceptance.legacyParityPassed === true &&
        acceptance.storageParityPassed === true,
      'Execution-observation acceptance mismatch',
    );
    for (const key of [
      'bridgeModule',
      'runtimeModule',
      'publicTypes',
      'parityReceipt',
      'rootReview',
    ]) {
      const descriptor = acceptance[key];
      const file = boundPath(projectRoot, descriptor.path);
      demand(
        (await boundedHash(file, 16 * 1024 * 1024)).sha256 ===
          descriptor.sha256,
        'Bridge/parity artifact checksum mismatch',
      );
      checked.push({ file, descriptor });
    }
  } else blockers.push('missing-accepted-opt-in-bridge-parity');
  const workerHashes = new Set();
  if (!Array.isArray(a.workerObservations) || !a.workerObservations.length)
    blockers.push('missing-secret-free-worker-observations');
  else
    for (const descriptor of a.workerObservations) {
      const worker = await readExecutedDescriptor(projectRoot, descriptor);
      checked.push(worker);
      const value = worker.value;
      const forbidden = (v) =>
        v &&
        typeof v === 'object' &&
        Object.entries(v).some(
          ([k, item]) =>
            ['argv', 'env', 'commandLine'].includes(k) || forbidden(item),
        );
      demand(
        !forbidden(value) &&
          value.schema === 'tradejs-research-worker-observation/v1' &&
          value.researchRunId === a.researchRunId &&
          value.compositionSha256 === a.compositionSpec.sha256 &&
          value.sourceConfigSha256 === bind.sourceConfigSha256 &&
          value.registrySingleton === true &&
          value.processReceipt,
        'Opt-in worker identity/registry/process receipt mismatch',
      );
      const processProof = await readExecutedDescriptor(
        projectRoot,
        value.processReceipt,
      );
      checked.push(processProof);
      const processValue = processProof.value;
      demand(
        !forbidden(processValue) &&
          processValue.schema ===
            'tradejs-research-worker-process-receipt/v1' &&
          processValue.researchRunId === value.researchRunId &&
          processValue.compositionSha256 === value.compositionSha256 &&
          processValue.sourceConfigSha256 === value.sourceConfigSha256 &&
          processValue.nodeVersion ===
            a.operationalNodeVersion.replace(/^v/, '') &&
          processValue.pid === value.pid &&
          processValue.ppid === value.ppid &&
          ['pid', 'ppid'].every(
            (k) => integer(processValue[k]) && processValue[k] > 0,
          ) &&
          finite(processValue.rss) &&
          processValue.rss >= 0 &&
          typeof processValue.comm === 'string' &&
          processValue.comm.length > 0,
        'Secret-free actual process/Node receipt mismatch',
      );
      workerHashes.add(descriptor.sha256);
    }
  if (
    a.completedStream?.status !== 'verified-empty' &&
    a.entryNotionalAuthority &&
    executionRuntime
  ) {
    await load('entryNotionalAuthority');
    entryNotional = await (
      validators.verifyEntryNotionalAuthority ?? verifyEntryNotionalAuthority
    )({
      projectRoot,
      entryNotionalAuthority: a.entryNotionalAuthority.path,
      executionRuntime,
      filePaths: a.completedStream.files.map((f) =>
        boundPath(projectRoot, f.path),
      ),
    });
  }
  return {
    authority: a,
    checked,
    composition,
    selection,
    config,
    universe,
    cohorts,
    time,
    bind,
    mapping,
    manifest: manifest.value,
    checkpoint: checkpoint.value,
    expectedBySymbol,
    workerHashes,
    blockers,
    executionRuntime,
    entryNotional,
  };
};

const compareTuple = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

// External merge of compact numeric/identity records only. No original payload.
export const createExecutedSorter = ({
  projectRoot,
  outputPath,
  authority,
  storage,
  limits = {},
}) => {
  const maxSortBytes = limits.maxSortBytes ?? 16777216;
  const fanIn = limits.fanIn ?? 16;
  const maxRows = limits.maxRows ?? 10000000;
  const maxDiskBytes = limits.maxDiskBytes ?? 8589934592;
  demand(
    integer(maxSortBytes) &&
      maxSortBytes >= 1024 &&
      maxSortBytes <= 16777216 &&
      integer(fanIn) &&
      fanIn >= 2 &&
      fanIn <= 16,
    'Invalid external sort bounds',
  );
  let pending = [],
    bytes = 0,
    rows = 0,
    peak = 0,
    disk = 0,
    n = 0,
    runs = [],
    closed = false;
  const resources = {
    peakLogicalSortBytes: 0,
    maxMergeHeads: 0,
    compactRows: 0,
    accountedDiskBytes: 0,
    wholePayloadsRetained: 0,
  };
  const sink = (prefix) =>
    createShardedCaptureSink({
      projectRoot,
      outputPath: prefix,
      authority,
      workerObservation: null,
      storage,
    });
  const descriptor = async (prefix) => ({
    path: `${prefix}.storage.json`,
    sha256: (await hashFile(boundPath(projectRoot, `${prefix}.storage.json`)))
      .sha256,
  });
  const account = (manifest) => {
    disk += manifest.shards.reduce(
      (s, shard) =>
        s +
        shard.physical.bytes +
        (storage.reclaimPlain ? 0 : shard.logical.bytes),
      0,
    );
    demand(disk <= maxDiskBytes, 'External spill disk bound exceeded');
    resources.accountedDiskBytes = disk;
  };
  const flush = async () => {
    if (!pending.length) return;
    demand(n < (limits.maxRuns ?? 4096), 'External sort run bound exceeded');
    pending.sort((a, b) => compareTuple(a.key, b.key));
    const prefix = `${outputPath}.run${n++}`;
    const out = sink(prefix);
    try {
      for (const row of pending) out.append(row);
      account(out.close());
    } catch (error) {
      out.abort();
      throw error;
    }
    runs.push(await descriptor(prefix));
    pending = [];
    bytes = 0;
  };
  return {
    resources,
    async append(key, value) {
      demand(
        !closed && Array.isArray(key) && !Object.hasOwn(value, 'payload'),
        'Compact sort key/value required',
      );
      const row = { key, value },
        size = Buffer.byteLength(canonicalJson(row)) + 1;
      demand(
        size <= 16384 && size <= maxSortBytes && ++rows <= maxRows,
        'External sort record/row bound exceeded',
      );
      if (bytes + size > maxSortBytes) await flush();
      pending.push(row);
      bytes += size;
      peak = Math.max(peak, bytes);
      resources.peakLogicalSortBytes = peak;
      resources.compactRows = rows;
    },
    async close() {
      demand(!closed, 'External sorter closed');
      closed = true;
      await flush();
      if (!runs.length) return { descriptor: null, resources };
      let generation = 0;
      while (runs.length > 1) {
        const next = [];
        for (let start = 0; start < runs.length; start += fanIn) {
          const group = runs.slice(start, start + fanIn);
          const readers = group.map((ref) =>
            readStorageManifest({
              projectRoot,
              descriptor: ref,
              authority,
              expectedStorage: storage,
            }),
          );
          const heads = await Promise.all(readers.map((r) => r.next()));
          resources.maxMergeHeads = Math.max(
            resources.maxMergeHeads,
            heads.filter((h) => !h.done).length,
          );
          const prefix = `${outputPath}.merge${generation}-${start}`,
            out = sink(prefix);
          try {
            while (true) {
              let selected = -1;
              for (let i = 0; i < heads.length; i++)
                if (
                  !heads[i].done &&
                  (selected < 0 ||
                    compareTuple(
                      heads[i].value.row.key,
                      heads[selected].value.row.key,
                    ) < 0)
                )
                  selected = i;
              if (selected < 0) break;
              out.append(heads[selected].value.row);
              heads[selected] = await readers[selected].next();
            }
            account(out.close());
            next.push(await descriptor(prefix));
          } catch (error) {
            out.abort();
            throw error;
          } finally {
            await Promise.all(readers.map((r) => r.return()));
          }
        }
        runs = next;
        generation++;
      }
      return { descriptor: runs[0], resources };
    },
  };
};

const ratio = (a, b) => (b > 0 && finite(a / b) ? a / b : null);
const accumulator = (axis, authorityStatus) => ({
  ...axis,
  authorityStatus,
  economicCompletenessStatus: 'COMPLETE',
  trades: 0,
  wins: 0,
  losses: 0,
  flats: 0,
  pnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  maxDrawdown: 0,
  maxLossStreak: 0,
  completedEvents: 0,
  activeDays: 0,
  losingMonths: 0,
  p95Batch: null,
  maxBatch: 0,
  topEventCountShare: null,
  topEventPnlShare: null,
  topSymbolCountShare: null,
  topSymbolPnlShare: null,
  p05Profit: null,
  p50Profit: null,
  p95Profit: null,
  p05HoldingHours: null,
  p50HoldingHours: null,
  p95HoldingHours: null,
  missingStressReasons: {},
  _streak: 0,
  _equity: 0,
  _peak: 0,
  _timestamp: null,
  _batchPnl: 0,
  _dailySum: 0,
  _dailySquares: 0,
  _downSquares: 0,
  _topEventN: 0,
  _topEventAbsPnl: 0,
  _absEventPnl: 0,
  _topSymbolN: 0,
  _topSymbolAbsPnl: 0,
  _absSymbolPnl: 0,
});
const flushExit = (c) => {
  if (c._timestamp === null) return;
  c._equity += c._batchPnl;
  c._peak = Math.max(c._peak, c._equity);
  c.maxDrawdown = Math.max(c.maxDrawdown, c._peak - c._equity);
  c._batchPnl = 0;
};
const recordTrade = (c, t, pnl) => {
  if (c._timestamp !== t.exitTimestamp) {
    flushExit(c);
    c._timestamp = t.exitTimestamp;
  }
  c.trades++;
  c.pnl += pnl;
  c._batchPnl += pnl;
  if (pnl > 0) {
    c.wins++;
    c.grossProfit += pnl;
    c._streak = 0;
  } else if (pnl < 0) {
    c.losses++;
    c.grossLoss -= pnl;
    c._streak++;
    c.maxLossStreak = Math.max(c.maxLossStreak, c._streak);
  } else {
    c.flats++;
    c._streak = 0;
  }
};
const finishCell = (c) => {
  flushExit(c);
  c.pnl = c._equity;
  const n = c.trades,
    days = c.days;
  c.winRate = n ? (c.wins / n) * 100 : null;
  c.profitFactor = ratio(c.grossProfit, c.grossLoss);
  c.profitFactorStatus = !n
    ? 'no-support'
    : !c.grossLoss
      ? 'no-losses'
      : 'finite';
  c.pnlPerTrade = n ? c.pnl / n : null;
  c.cadencePerDay = days > 0 ? n / days : null;
  c.completedEventsPerDay = days > 0 ? c.completedEvents / days : null;
  c.activeDayRatio = days > 0 ? c.activeDays / Math.ceil(days) : null;
  c.tradesPerEvent = ratio(n, c.completedEvents);
  c.averageWin = ratio(c.grossProfit, c.wins);
  c.averageLoss = c.losses ? -c.grossLoss / c.losses : null;
  c.payoffRatio =
    c.averageWin !== null && c.averageLoss < 0
      ? c.averageWin / -c.averageLoss
      : null;
  c.topEventCountShare = ratio(c._topEventN, n);
  c.topEventPnlShare = ratio(c._topEventAbsPnl, c._absEventPnl);
  c.topSymbolCountShare = ratio(c._topSymbolN, n);
  c.topSymbolPnlShare = ratio(c._topSymbolAbsPnl, c._absSymbolPnl);
  const mean = days > 0 ? c._dailySum / days : null;
  const variance =
    days > 1
      ? Math.max(0, (c._dailySquares - days * mean ** 2) / (days - 1))
      : null;
  c.sharpeRatio =
    n && variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(365) : null;
  c.sortinoRatio =
    n && c._downSquares > 0 && days > 0
      ? (mean / Math.sqrt(c._downSquares / days)) * Math.sqrt(365)
      : null;
  c.calmarRatio =
    n && c.maxDrawdown > 0 && days > 0
      ? ((c.pnl / days) * 365) / c.maxDrawdown
      : null;
  c.activityStatus = n
    ? 'observed-completed-stream'
    : c.days === null
      ? 'UNKNOWN-membership'
      : 'verified-zero-activity';
  if (c.holdingHoursStatus === 'UNKNOWN-missing-actual-entry-timestamp') {
    c.p05HoldingHours = null;
    c.p50HoldingHours = null;
    c.p95HoldingHours = null;
  } else c.holdingHoursStatus = n ? 'COMPLETE' : 'no-support';
  if (c.days === null) {
    c.economicCompletenessStatus = 'UNKNOWN';
    c.authorityStatus = 'UNKNOWN';
    for (const key of [
      'trades',
      'completedEvents',
      'activeDays',
      'maxBatch',
      'p95Batch',
      'tradesPerEvent',
      'topEventCountShare',
      'topSymbolCountShare',
    ])
      c[key] = null;
  }
  if (c.economicCompletenessStatus === 'UNKNOWN') {
    for (const k of [
      'wins',
      'losses',
      'flats',
      'pnl',
      'pnlPerTrade',
      'grossProfit',
      'grossLoss',
      'profitFactor',
      'winRate',
      'maxDrawdown',
      'maxLossStreak',
      'averageWin',
      'averageLoss',
      'payoffRatio',
      'sharpeRatio',
      'sortinoRatio',
      'calmarRatio',
      'topEventPnlShare',
      'topSymbolPnlShare',
      'p05Profit',
      'p50Profit',
      'p95Profit',
      'losingMonths',
    ])
      c[k] = null;
    c.profitFactorStatus = 'UNKNOWN';
    c.authorityStatus = 'UNKNOWN';
  }
  for (const k of Object.keys(c)) if (k.startsWith('_')) delete c[k];
  return c;
};

async function* scanSet(projectRoot, stream, checked, resources) {
  demand(
    stream?.schema === 'tradejs-bounded-jsonl-stream-set/v1' &&
      stream.status === 'closed' &&
      Array.isArray(stream.files),
    'Closed bounded native stream set required',
  );
  demand(
    integer(stream.maxRows) &&
      stream.maxRows >= 0 &&
      integer(stream.maxBytes) &&
      stream.maxBytes >= 0 &&
      stream.files.length <= 65536,
    'Explicit native stream bounds required',
  );
  let rows = 0,
    bytes = 0;
  for (const ref of stream.files) {
    const file = boundPath(projectRoot, ref.path),
      digest = await boundedHash(file, stream.maxBytes || 1);
    demand(
      digest.sha256 === ref.sha256 && digest.bytes === ref.bytes,
      'Native stream checksum/bytes mismatch',
    );
    checked.push({ file, descriptor: ref });
    bytes += digest.bytes;
    demand(bytes <= stream.maxBytes, 'Native stream total byte bound exceeded');
    for await (const line of scanJsonLines(file, {
      maxLineBytes: stream.maxLineBytes ?? 1048576,
      canonical: stream.canonical !== false,
    })) {
      demand(++rows <= stream.maxRows, 'Native stream row bound exceeded');
      yield line.row;
    }
  }
  demand(rows === stream.rows, 'Native stream semantic row count mismatch');
  resources.inputBytes += bytes;
  resources.inputRows += rows;
}

export const deriveExecutedCompositionReport = async ({
  projectRoot,
  descriptor,
  outputPrefix,
  validators = {},
  limits = {},
}) => {
  projectRoot = fs.realpathSync(projectRoot);
  const verified = await verifyExecutedCompositionAuthority({
    projectRoot,
    descriptor,
    validators,
  });
  const {
    authority: a,
    checked,
    universe,
    cohorts,
    time,
    bind,
    blockers,
  } = verified;
  const storage = a.reportingStorage;
  storageLimits(storage);
  const out = boundPath(projectRoot, outputPrefix, false);
  demand(
    !fs.existsSync(`${out}.report.json`) &&
      !fs.existsSync(`${out}.receipt.json`),
    'Exclusive output already exists',
  );
  const resources = {
    inputRows: 0,
    inputBytes: 0,
    storageArchivesDecoded: 0,
    wholePayloadsRetained: 0,
    indexes: [],
    sorts: [],
  };
  const availability = {};
  const observe = (stream, row, field, valid) => {
    const key = `${stream}.${field}`,
      kind = fieldAvailability(row, field, valid);
    const counts = (availability[key] ??= {
      present: 0,
      'explicit-null': 0,
      missing: 0,
      invalid: 0,
      unsupported: 0,
    });
    counts[kind]++;
    return kind;
  };
  const cohortOf = new Map(
    cohorts.groups.flatMap((g, i) => g.symbols.map((s) => [s, GROUPS[i + 1]])),
  );
  const keyOf = (r) => canonicalJson([r.symbol, r.signalId]);
  const compactIdentity = (r) => {
    demand(
      universe.includes(r.symbol) &&
        typeof r.signalId === 'string' &&
        r.signalId &&
        ['LONG', 'SHORT'].includes(r.direction),
      'Foreign/missing completed identity',
    );
    return {
      symbol: r.symbol,
      signalId: r.signalId,
      direction: r.direction,
      timestamp: r.timestamp,
      invocationId: r.invocationId ?? null,
    };
  };
  const stageNames = [
    'inventory',
    'capture',
    'gate',
    'link',
    'attempt',
    'execution',
    'entryTrace',
    'exitTrace',
  ];
  const indexes = {};
  const funnel = Object.fromEntries(stageNames.map((s) => [s, 0]));
  funnel.allowed = 0;
  funnel.blocked = 0;
  funnel.allowedWithoutExecution = 0;
  funnel.priorManifestVetoWithoutOwnGate = 0;
  const decisionFunnel = executedAxes(time)
    .slice(72)
    .map((axis) => ({
      ...axis,
      authorityStatus: axis.days === null ? 'UNKNOWN' : 'COMPLETE',
      inventory: axis.days === null ? null : 0,
      capture: axis.days === null ? null : 0,
      gate: axis.days === null ? null : 0,
      allowed: axis.days === null ? null : 0,
      blocked: axis.days === null ? null : 0,
      link: axis.days === null ? null : 0,
      attempt: axis.days === null ? null : 0,
      execution: axis.days === null ? null : 0,
      entryTrace: axis.days === null ? null : 0,
      exitTrace: axis.days === null ? null : 0,
    }));
  const createIndex = (name) =>
    createDiskIdentityIndex({
      projectRoot,
      directory: `${outputPrefix}.${name}-index`,
      maxSortBytes: limits.maxSortBytes ?? 16777216,
      maxRecordBytes: 4096,
      maxRows: limits.maxRows ?? 1000000,
      maxBytes: limits.maxIndexBytes ?? 268435456,
      maxDiskBytes: limits.maxDiskBytes ?? 2147483648,
      fanIn: limits.fanIn ?? 16,
    });
  for (const name of [
    'capture',
    ...stageNames.filter((name) => name !== 'capture'),
  ]) {
    const builder = createIndex(name);
    const stream = a.streams?.[name];
    if (!stream) {
      blockers.push(`missing-${name}-stream`);
      for (const cell of decisionFunnel) {
        cell[name] = null;
        cell.authorityStatus = 'UNKNOWN';
        if (name === 'gate') {
          cell.allowed = null;
          cell.blocked = null;
        }
      }
      indexes[name] = await builder.close();
      continue;
    }
    const scan = stream.storageManifest
      ? readStorageManifest({
          projectRoot,
          descriptor: stream.storageManifest,
          authority: bind,
          expectedStorage: stream.storage,
          onDecode: () => resources.storageArchivesDecoded++,
        })
      : null;
    if (scan) {
      const meta = await readExecutedDescriptor(
        projectRoot,
        stream.storageManifest,
      );
      checked.push(meta);
      for (const shard of meta.value.shards)
        for (const ref of [shard.physical, shard.receipt])
          checked.push({
            file: boundPath(projectRoot, ref.path),
            descriptor: ref,
          });
    }
    const iterable = scan ?? scanSet(projectRoot, stream, checked, resources);
    for await (const entry of iterable) {
      const row = scan ? entry.row : entry;
      if (stream.stage !== undefined) {
        const requiredStage = {
          link: 'gate-invocation-link',
          attempt: 'before-place-order-attempt',
          execution: 'after-place-order-executed',
        }[name];
        demand(
          requiredStage &&
            stream.stage === requiredStage &&
            row.schema === 'tradejs-entry-execution-observation/v1',
          'Checksum-bound mixed-stream stage selector mismatch',
        );
        if (row.stage !== requiredStage) continue;
      }
      if (name === 'capture') validateCapture(row, bind);
      let identityRow = row;
      if (['inventory', 'gate', 'entryTrace', 'exitTrace'].includes(name)) {
        const capture = indexes.capture.get(keyOf(row));
        demand(
          capture &&
            (name.endsWith('Trace') || capture.timestamp === row.timestamp),
          'Legacy/native identity lacks exact original capture',
        );
        demand(
          row.direction === undefined || row.direction === capture.direction,
          'Legacy/native direction differs from original capture',
        );
        identityRow = { ...row, direction: capture.direction };
      }
      for (const field of ['symbol', 'signalId', 'direction', 'timestamp'])
        observe(
          name,
          row,
          field,
          field === 'timestamp'
            ? integer
            : (v) => typeof v === 'string' && v.length > 0,
        );
      if (['link', 'attempt', 'execution'].includes(name)) {
        demand(
          row.schema === 'tradejs-entry-execution-observation/v1' &&
            row.stage ===
              {
                link: 'gate-invocation-link',
                attempt: 'before-place-order-attempt',
                execution: 'after-place-order-executed',
              }[name],
          'Separate opt-in stage schema required',
        );
        demand(
          SHA.test(row.invocationId ?? ''),
          'Explicit invocationId required',
        );
        demand(
          integer(row.observationSequence) &&
            row.observationSequence >= 0 &&
            verified.workerHashes.has(row.workerObservationSha256),
          'Explicit stage sequence/worker authority required',
        );
        if (name === 'link' && row.ownGateCalled === false) {
          demand(
            row.priorManifestVeto === true &&
              row.allow === false &&
              row.gateObservationSha256 === null,
            'Prior veto cannot invent an own gate hash',
          );
          funnel.priorManifestVetoWithoutOwnGate++;
          continue; // Diagnostic only: no fabricated gate or own-chain index entry.
        }
        if (name === 'link')
          demand(
            SHA.test(row.gateObservationSha256 ?? ''),
            'Parallel invocation link must bind unchanged gate bytes',
          );
      }
      if (name === 'gate') {
        demand(
          row.schema === 'tradejs-entry-gate-observation/v1' &&
            typeof row.allow === 'boolean',
          'Legacy gate allow observation required',
        );
        row.allow ? funnel.allowed++ : funnel.blocked++;
      }
      if (name.endsWith('Trace')) {
        demand(
          row.event ===
            (name === 'entryTrace' ? 'entry_executed' : 'position_exited') &&
            row.backtestRunId === a.actualBacktestRunId &&
            verified.mapping.attempts.get(row.symbol)?.testKey ===
              row.backtestTestKey,
          'Native trace identity mismatch',
        );
      } else
        demand(
          row.researchRunId === a.researchRunId &&
            row.compositionSha256 === a.compositionSpec.sha256,
          'Foreign hook composition/run',
        );
      const value = {
        ...compactIdentity(identityRow),
        ...(name === 'gate'
          ? { allow: row.allow, observationSha256: objectSha256(row) }
          : {}),
        ...(['link', 'attempt', 'execution'].includes(name)
          ? {
              observationSequence: row.observationSequence,
              workerObservationSha256: row.workerObservationSha256,
              ...(name === 'link'
                ? { gateObservationSha256: row.gateObservationSha256 }
                : {}),
            }
          : {}),
      };
      for (const cell of name.endsWith('Trace') ? [] : decisionFunnel) {
        if (!integer(row.timestamp)) {
          cell[name] = null;
          cell.authorityStatus = 'UNKNOWN';
          continue;
        }
        const member =
          identityRow.timestamp >= cell.start &&
          identityRow.timestamp < cell.end &&
          (cell.symbolGroupId === 'ALL_UNIVERSE' ||
            cell.symbolGroupId === cohortOf.get(identityRow.symbol)) &&
          (cell.direction === 'ALL' ||
            cell.direction === identityRow.direction);
        if (member && cell[name] !== null) {
          cell[name]++;
          if (name === 'gate') row.allow ? cell.allowed++ : cell.blocked++;
        }
      }
      builder.append(keyOf(row), value);
      funnel[name]++;
    }
    indexes[name] = await builder.close();
    resources.indexes.push(indexes[name].resources);
  }
  for await (const entry of indexes.gate.entries()) {
    const gate = entry.row.value,
      key = entry.row.key;
    demand(
      indexes.inventory.get(key) && indexes.capture.get(key),
      'Gate missing prequeue inventory/capture',
    );
    const stages = [
      'link',
      'attempt',
      'execution',
      'entryTrace',
      'exitTrace',
    ].map((s) => indexes[s].get(key));
    if (!gate.allow) {
      demand(
        stages.slice(1).every((s) => s === null),
        'Blocked identity appears downstream',
      );
      if (stages[0])
        demand(
          stages[0].gateObservationSha256 === gate.observationSha256,
          'Blocked identity link must bind exact false gate',
        );
    } else {
      if (!stages[2]) funnel.allowedWithoutExecution++;
      if (stages[0])
        demand(
          stages[0].gateObservationSha256 === gate.observationSha256,
          'Invocation link gate checksum mismatch',
        );
      if (stages[1])
        demand(
          stages[0] &&
            stages[1].invocationId === stages[0].invocationId &&
            stages[1].workerObservationSha256 ===
              stages[0].workerObservationSha256 &&
            stages[1].observationSequence > stages[0].observationSequence,
          'Attempt lacks exact earlier invocation link',
        );
      if (stages[2])
        demand(
          stages[1] &&
            stages[2].invocationId === stages[1].invocationId &&
            stages[2].workerObservationSha256 ===
              stages[1].workerObservationSha256 &&
            stages[2].observationSequence > stages[1].observationSequence,
          'Execution lacks earlier attempt',
        );
    }
  }
  for (const name of [
    'link',
    'attempt',
    'execution',
    'entryTrace',
    'exitTrace',
  ])
    for await (const entry of indexes[name].entries()) {
      const gate = indexes.gate.get(entry.row.key);
      demand(
        name === 'link' ? gate !== null : gate?.allow === true,
        'Orphan downstream stage',
      );
      if (name.endsWith('Trace')) {
        const capture = indexes.capture.get(entry.row.key);
        demand(capture, 'Native trace lacks original decision capture');
        for (const cell of decisionFunnel) {
          const member =
            capture.timestamp >= cell.start &&
            capture.timestamp < cell.end &&
            (cell.symbolGroupId === 'ALL_UNIVERSE' ||
              cell.symbolGroupId === cohortOf.get(capture.symbol)) &&
            (cell.direction === 'ALL' || cell.direction === capture.direction);
          if (member && cell[name] !== null) cell[name]++;
        }
      }
    }
  const sorter = createExecutedSorter({
    projectRoot,
    outputPath: `${outputPrefix}.exit-sort`,
    authority: bind,
    storage,
    limits,
  });
  const native = { trades: 0, wins: 0, losses: 0, flats: 0, pnl: 0 };
  // Fixed 576 scalar counters from the frozen universe, never a payload/event map.
  const bySymbol = new Map(
    universe.map((s) => [
      s,
      { trades: 0, wins: 0, losses: 0, flats: 0, pnl: 0 },
    ]),
  );
  const counters = {
    devTrainingEligibleCompleted: 0,
    devCrossingGateCutoffCompletedDiagnostic: 0,
    testFinalEligibleCompleted: 0,
    exitAtFrozenEndNativeOnly: 0,
    prospectiveBeyondFrozenEnd: 0,
    newTailDevTrainingEligibleCompletedCount: 0,
    newTailDevCrossingCompletedDiagnosticCount: 0,
    newTailTestFinalEligibleCompletedCount: 0,
    newTailUnknownPartitionCount: 0,
  };
  const completed = a.completedStream;
  if (completed?.status === 'verified-empty')
    demand(
      completed.files?.length === 0 &&
        completed.rows === 0 &&
        indexes.execution.rows === 0 &&
        indexes.entryTrace.rows === 0 &&
        indexes.exitTrace.rows === 0,
      'Zero completion requires zero execution/trace and no fake export',
    );
  else
    for await (const r of scanSet(projectRoot, completed, checked, resources)) {
      const signal = r.payload?.signal ?? r.signal;
      demand(signal, 'Actual completed signal required');
      const identity = compactIdentity(signal),
        key = keyOf(identity);
      demand(
        r.backtestRunId === a.actualBacktestRunId &&
          verified.mapping.attempts.get(identity.symbol)?.testKey ===
            r.backtestTestKey,
        'Completed run/test mismatch',
      );
      const capture = indexes.capture.get(key, true),
        gate = indexes.gate.get(key),
        link = indexes.link.get(key),
        attempt = indexes.attempt.get(key),
        execution = indexes.execution.get(key, true);
      demand(
        capture &&
          gate?.allow === true &&
          link &&
          attempt &&
          execution &&
          indexes.entryTrace.get(key, true) &&
          indexes.exitTrace.get(key, true),
        'Incomplete own-fill chain',
      );
      demand(
        [attempt, execution].every(
          (s) => s.invocationId === link.invocationId,
        ) &&
          capture.timestamp === signal.timestamp &&
          capture.direction === signal.direction,
        'Own-fill invocation/decision mismatch',
      );
      const result = r.tradeResult;
      demand(
        result && finite(result.netProfit),
        'Missing completed net profit',
      );
      demand(
        indexes.entryTrace.get(key).timestamp === result.entryTimestamp &&
          indexes.exitTrace.get(key).timestamp === result.exitTimestamp,
        'Actual native entry/exit clock differs from completed fill',
      );
      const exit =
        observe('completed', result, 'exitTimestamp', integer) === 'present'
          ? result.exitTimestamp
          : null;
      for (const field of ['qty', 'closedQty', 'openFee', 'entryPrice'])
        observe('completed', result, field, (n) => finite(n) && n > 0);
      const label = classifyExecutedLabel(capture.timestamp, exit, time);
      if (exit === null) blockers.push('unknown-completed-exit');
      native.trades++;
      native.pnl += result.netProfit;
      if (result.netProfit > 0) native.wins++;
      else if (result.netProfit < 0) native.losses++;
      else native.flats++;
      const symbolCounts = bySymbol.get(identity.symbol);
      symbolCounts.trades++;
      symbolCounts.pnl += result.netProfit;
      symbolCounts[
        result.netProfit > 0
          ? 'wins'
          : result.netProfit < 0
            ? 'losses'
            : 'flats'
      ]++;
      if (label.primary === 'OUTER_DEV_FROZEN')
        counters.devTrainingEligibleCompleted++;
      if (label.primary === 'OUTER_TEST_FROZEN')
        counters.testFinalEligibleCompleted++;
      if (label.devCrossing)
        counters.devCrossingGateCutoffCompletedDiagnostic++;
      if (label.exactEnd) counters.exitAtFrozenEndNativeOnly++;
      if (label.beyond) counters.prospectiveBeyondFrozenEnd++;
      if (label.newTailIntersection === 'DEV' && label.primary)
        counters.newTailDevTrainingEligibleCompletedCount++;
      if (label.newTailIntersection === 'DEV' && label.devCrossing)
        counters.newTailDevCrossingCompletedDiagnosticCount++;
      if (label.newTailIntersection === 'TEST' && label.primary)
        counters.newTailTestFinalEligibleCompletedCount++;
      if (label.newTail && label.newTailIntersection === null)
        counters.newTailUnknownPartitionCount++;
      const actualEntryNotional = verified.entryNotional
        ? null
        : getEntryStressNotional(result);
      const notional = verified.entryNotional
        ? deriveFeeEntryStressNotional(result, verified.entryNotional)
        : finite(actualEntryNotional) && actualEntryNotional > 0
          ? {
              status: 'complete',
              notional: actualEntryNotional,
              reason: null,
            }
          : {
              status: 'missing',
              reason: 'missing-or-invalid-actual-entry-notional',
            };
      if (exit !== null)
        await sorter.append(
          [
            exit,
            a.actualBacktestRunId,
            r.backtestTestKey,
            identity.symbol,
            identity.signalId,
            link.invocationId,
          ],
          {
            ...identity,
            decisionTimestamp: capture.timestamp,
            exitTimestamp: exit,
            entryTimestamp: integer(result.entryTimestamp)
              ? result.entryTimestamp
              : null,
            invocationId: link.invocationId,
            pnl: result.netProfit,
            stressPnl:
              notional.status === 'complete'
                ? result.netProfit - (notional.notional * 20) / 10000
                : null,
            stressReason: notional.reason ?? null,
          },
        );
    }
  const unmatchedExecutedClosures = {
    count: 0,
    status: 'NONE',
    classification: 'unknown-native-completed-closure',
    identities: [],
    identitiesComplete: true,
    maxExampleIdentities: 100,
    evidence: 'Unchanged checksum-bound execution streams and compact index',
    meaning:
      'Observed successful own entry without either native completed-closure trace. Not a closed trade, pending-position proof, nonfill, zero PnL or realized loss.',
  };
  for await (const entry of indexes.execution.entries()) {
    const key = entry.row.key;
    const hasEntry = indexes.entryTrace.get(key) !== null;
    const hasExit = indexes.exitTrace.get(key) !== null;
    demand(hasEntry === hasExit, 'One-sided native closure trace');
    if (!hasEntry) {
      unmatchedExecutedClosures.count++;
      if (unmatchedExecutedClosures.identities.length < 100)
        unmatchedExecutedClosures.identities.push(entry.row.value);
      else unmatchedExecutedClosures.identitiesComplete = false;
    }
  }
  if (unmatchedExecutedClosures.count) {
    unmatchedExecutedClosures.status = 'UNKNOWN';
    blockers.push('successful-entry-without-native-completed-closure');
  }
  demand(
    native.trades === indexes.exitTrace.rows &&
      native.trades === indexes.entryTrace.rows &&
      native.trades + unmatchedExecutedClosures.count ===
        indexes.execution.rows,
    'Completed/execution/entry/exit-trace count mismatch',
  );
  const expected = a.nativeReconciliation;
  demand(
    expected &&
      ['trades', 'wins', 'losses', 'flats'].every(
        (k) => integer(expected[k]) && expected[k] === native[k],
      ),
    'Exact native N/W/L/flat reconciliation mismatch',
  );
  demand(
    finite(expected.pnl) &&
      finite(expected.pnlRoundingBound) &&
      expected.pnlRoundingBound >= 0 &&
      Math.abs(native.pnl - expected.pnl) <= expected.pnlRoundingBound,
    'Native PnL rounding reconciliation mismatch',
  );
  for (const [symbol, actual] of bySymbol) {
    const wanted = verified.expectedBySymbol.get(symbol);
    demand(
      wanted &&
        ['trades', 'wins', 'losses', 'flats'].every(
          (k) => actual[k] === wanted[k],
        ) &&
        Math.abs(actual.pnl - wanted.pnl) <= 0.005,
      'Per-symbol completed/native reconciliation mismatch',
    );
  }
  const sorted = await sorter.close();
  resources.sorts.push(sorted.resources);
  const status = blockers.length ? 'UNKNOWN' : 'COMPLETE';
  const axes = executedAxes(time);
  const observed = axes.map((axis) => accumulator(axis, status));
  const stress = axes.map((axis) => accumulator(axis, status));
  const statistics = createExecutedSorter({
    projectRoot,
    outputPath: `${outputPrefix}.stats-sort`,
    authority: bind,
    storage,
    limits,
  });
  let equitySink = null,
    equityPnl = 0,
    equityTime = null,
    equityBatch = 0,
    equityRows = 0;
  const writeEquity = () => {
    if (equityTime === null) return;
    equityPnl += equityBatch;
    equitySink ??= createShardedCaptureSink({
      projectRoot,
      outputPath: `${outputPrefix}.equity`,
      authority: bind,
      workerObservation: null,
      storage,
    });
    equitySink.append({ timestamp: equityTime, pnl: equityPnl });
    equityRows++;
    equityBatch = 0;
  };
  if (sorted.descriptor)
    for await (const { row: record } of readStorageManifest({
      projectRoot,
      descriptor: sorted.descriptor,
      authority: bind,
      expectedStorage: storage,
    })) {
      const t = record.value,
        label = classifyExecutedLabel(
          t.decisionTimestamp,
          t.exitTimestamp,
          time,
        );
      if (label.economic) {
        if (equityTime !== t.exitTimestamp) {
          writeEquity();
          equityTime = t.exitTimestamp;
        }
        equityBatch += t.pnl;
      }
      for (let i = 0; i < axes.length; i++) {
        const axis = axes[i];
        const member =
          axis.axis === 'exit-window'
            ? t.exitTimestamp >= axis.start &&
              t.exitTimestamp < axis.end &&
              label.economic
            : axis.id === 'NEW_TAIL_DIAGNOSTIC'
              ? label.economic && label.newTail
              : label.primary === axis.id;
        if (
          !member ||
          (axis.direction !== 'ALL' && axis.direction !== t.direction) ||
          (axis.symbolGroupId !== 'ALL_UNIVERSE' &&
            axis.symbolGroupId !== cohortOf.get(t.symbol))
        )
          continue;
        for (let basis = 0; basis < 2; basis++) {
          const c = basis ? stress[i] : observed[i],
            value = basis ? t.stressPnl : t.pnl,
            index = basis * 99 + i;
          if (value === null) {
            c.economicCompletenessStatus = 'UNKNOWN';
            c.missingStressReasons[t.stressReason] =
              (c.missingStressReasons[t.stressReason] ?? 0) + 1;
            c.trades++;
            for (const [kind, group] of [
              ['event', t.decisionTimestamp],
              ['symbol', t.symbol],
              ['day', Math.floor(t.exitTimestamp / DAY)],
              ['month', new Date(t.exitTimestamp).toISOString().slice(0, 7)],
            ])
              await statistics.append([index, kind, group, t.invocationId], {
                amount: null,
              });
            continue;
          }
          recordTrade(c, t, value);
          const statisticsRows = [
            ['event', t.decisionTimestamp, value],
            ['symbol', t.symbol, value],
            ['day', Math.floor(t.exitTimestamp / DAY), value],
            [
              'month',
              new Date(t.exitTimestamp).toISOString().slice(0, 7),
              value,
            ],
            ['profit', value, value],
          ];
          if (t.entryTimestamp !== null)
            statisticsRows.push([
              'holding',
              (t.exitTimestamp - t.entryTimestamp) / 3600000,
              value,
            ]);
          else c.holdingHoursStatus = 'UNKNOWN-missing-actual-entry-timestamp';
          for (const [kind, group, amount] of statisticsRows)
            await statistics.append([index, kind, group, t.invocationId], {
              amount,
            });
        }
      }
    }
  writeEquity();
  let equity = { status: 'verified-empty', stream: null, rows: 0 };
  if (equitySink) {
    const m = equitySink.close();
    equity = {
      status: 'observed-exit-groups',
      stream: {
        path: `${outputPrefix}.equity.storage.json`,
        sha256: (
          await hashFile(
            boundPath(projectRoot, `${outputPrefix}.equity.storage.json`),
          )
        ).sha256,
      },
      rows: m.rows,
      authority: bind,
      storage,
    };
  } else if (native.trades > 0 && blockers.length)
    equity = { status: 'unavailable', stream: null, rows: null };
  resources.equityObservationsWritten = equityRows;
  const stats = await statistics.close();
  resources.sorts.push(stats.resources);
  const batchSort = createExecutedSorter({
    projectRoot,
    outputPath: `${outputPrefix}.batch-sort`,
    authority: bind,
    storage,
    limits,
  });
  let prior = null,
    groupN = 0,
    groupPnl = 0,
    rank = 0;
  const allCells = [...observed, ...stress];
  const flushGroup = async () => {
    if (!prior) return;
    const [index, kind] = prior,
      c = allCells[index];
    if (kind === 'event') {
      c.completedEvents++;
      c.maxBatch = Math.max(c.maxBatch, groupN);
      c._topEventN = Math.max(c._topEventN, groupN);
      if (groupPnl !== null) {
        c._topEventAbsPnl = Math.max(c._topEventAbsPnl, Math.abs(groupPnl));
        c._absEventPnl += Math.abs(groupPnl);
      }
      await batchSort.append([index, groupN, c.completedEvents], {
        amount: groupN,
      });
    }
    if (kind === 'symbol') {
      c._topSymbolN = Math.max(c._topSymbolN, groupN);
      if (groupPnl !== null) {
        c._topSymbolAbsPnl = Math.max(c._topSymbolAbsPnl, Math.abs(groupPnl));
        c._absSymbolPnl += Math.abs(groupPnl);
      }
    }
    if (kind === 'day') {
      c.activeDays++;
      if (groupPnl !== null) {
        c._dailySum += groupPnl;
        c._dailySquares += groupPnl ** 2;
        if (groupPnl < 0) c._downSquares += groupPnl ** 2;
      }
    }
    if (kind === 'month' && groupPnl !== null && groupPnl < 0) c.losingMonths++;
    groupN = 0;
    groupPnl = 0;
  };
  if (stats.descriptor)
    for await (const { row: record } of readStorageManifest({
      projectRoot,
      descriptor: stats.descriptor,
      authority: bind,
      expectedStorage: storage,
    })) {
      const [index, kind, group] = record.key,
        c = allCells[index];
      if (!prior || prior[0] !== index || prior[1] !== kind) {
        await flushGroup();
        prior = [index, kind, group];
        rank = 0;
      } else if (prior[2] !== group && !['profit', 'holding'].includes(kind)) {
        await flushGroup();
        prior = [index, kind, group];
      }
      rank++;
      groupN++;
      groupPnl =
        groupPnl === null || record.value.amount === null
          ? null
          : groupPnl + record.value.amount;
      if (['profit', 'holding'].includes(kind))
        for (const p of [5, 50, 95])
          if (rank === Math.max(1, Math.ceil((c.trades * p) / 100)))
            c[
              `p${String(p).padStart(2, '0')}${kind === 'profit' ? 'Profit' : 'HoldingHours'}`
            ] = group;
    }
  await flushGroup();
  const batches = await batchSort.close();
  resources.sorts.push(batches.resources);
  let batchIndex = -1,
    batchRank = 0;
  if (batches.descriptor)
    for await (const { row } of readStorageManifest({
      projectRoot,
      descriptor: batches.descriptor,
      authority: bind,
      expectedStorage: storage,
    })) {
      const [index, count] = row.key;
      if (batchIndex !== index) {
        batchIndex = index;
        batchRank = 0;
      }
      if (
        ++batchRank ===
        Math.max(1, Math.ceil(allCells[index].completedEvents * 0.95))
      )
        allCells[index].p95Batch = count;
    }
  observed.forEach(finishCell);
  stress.forEach(finishCell);
  for (let i = 0; i < observed.length; i++)
    demand(
      observed[i].trades === stress[i].trades &&
        observed[i].completedEvents === stress[i].completedEvents,
      'Stress identity/support membership drift',
    );
  for (const index of Object.values(indexes)) await index.verify();
  for (const item of checked)
    demand(
      (await hashFile(item.file)).sha256 === item.descriptor.sha256,
      'Input changed during report',
    );
  if (verified.entryNotional)
    await (
      validators.verifyEntryNotionalInputStability ??
      verifyEntryNotionalInputStability
    )(verified.entryNotional);
  const cell = (matrix) =>
    matrix.find(
      (c) =>
        c.id === 'OUTER_TEST_FROZEN' &&
        c.symbolGroupId === 'ALL_UNIVERSE' &&
        c.direction === 'ALL',
    );
  const report = {
    schema: 'tradejs-executed-composition-report/v1',
    executionBasis: 'closed-loop-execution',
    metricBasis: 'completed-trade',
    researchId: a.researchId,
    candidateId: a.candidateId,
    compositionId: a.compositionId,
    actualBacktestRunId: a.actualBacktestRunId,
    authority: descriptor,
    authorityStatus: status,
    blockers: [...new Set(blockers)],
    riskUnit: 10,
    comparisonWindow: { start: time.start, end: time.end },
    gateCutoff: time.gateCutoff,
    coverage: { requestedDays: 1825, coveredDays: 1461, complete: false },
    economics: {
      ordering:
        'exitTimestamp grouped; stable run/test/symbol/signal/invocation loss-streak ties',
      occupancy: 'actual closed-loop execution, not conditional posthoc subset',
      eventSupport: 'unique original decision timestamps',
      stress: verified.entryNotional
        ? 'extra20bps verified fee-derived entry-notional; same identities/qty/occupancy'
        : 'extra20bps closedQty (or qty when absent) * actual entryPrice; same identities/qty/occupancy',
    },
    matrices: {
      observed: {
        exitWindow: observed.slice(0, 72),
        decisionPartition: observed.slice(72),
      },
      stress20bps: {
        exitWindow: stress.slice(0, 72),
        decisionPartition: stress.slice(72),
      },
    },
    frozenCriteria: FROZEN_COMPOSITION_CRITERIA,
    selectionDecision: evaluateFrozenCompositionCriteria(
      cell(observed),
      cell(stress),
      verified.selection.criteria,
      blockers,
    ),
    nativeReconciliation: {
      ...native,
      expected,
      status: 'MATCH',
      economicBoundary: 'exact-END native only',
    },
    funnel,
    unmatchedExecutedClosures,
    decisionFunnel,
    crossing: counters,
    fieldAvailability: availability,
    equity,
    inputs: checked.map((i) => i.descriptor),
    resources,
    limitations: [
      'Research baseline is installed stable core + exact current gate; not active production.',
      'No forward promotion is established by this report.',
      'Own-fill authority requires separately accepted bridge/parity receipts.',
    ],
  };
  validateExecutedCompositionReport(report);
  writeExclusiveJson(`${out}.report.json`, report);
  const reportDescriptor = {
    path: `${outputPrefix}.report.json`,
    sha256: (await hashFile(`${out}.report.json`)).sha256,
  };
  const receipt = {
    schema: 'tradejs-executed-composition-report-receipt/v1',
    status: 'derived-inputs-unchanged',
    authority: descriptor,
    report: reportDescriptor,
    inputStabilityVerified: true,
    metricImplementation: { path: SELF, sha256: (await hashFile(SELF)).sha256 },
    runtimeValidation: {
      checkpoint: a.runtimeCheckpoint ?? null,
      strategyArtifactAuthority: a.strategyArtifactAuthority ?? null,
      phase: 'derive-before-candidate-overlay-restoration',
      readOnly: true,
      sourceBuildNodeVersion: a.sourceBuildNodeVersion,
      operationalNodeVersion: a.operationalNodeVersion,
    },
    resources,
    acceptedForActualUse: status === 'COMPLETE',
    limitations: report.limitations,
  };
  writeExclusiveJson(`${out}.receipt.json`, receipt);
  return {
    report,
    receipt,
    reportDescriptor,
    receiptDescriptor: {
      path: `${outputPrefix}.receipt.json`,
      sha256: (await hashFile(`${out}.receipt.json`)).sha256,
    },
  };
};

export const validateExecutedCompositionReport = (report) => {
  demand(
    report?.schema === 'tradejs-executed-composition-report/v1' &&
      report.executionBasis === 'closed-loop-execution' &&
      report.metricBasis === 'completed-trade',
    'Executed report schema/basis required',
  );
  for (const basis of ['observed', 'stress20bps']) {
    const m = report.matrices?.[basis];
    demand(
      m?.exitWindow?.length === 72 && m?.decisionPartition?.length === 27,
      'Exact99 cells required for each basis',
    );
    const cells = [...m.exitWindow, ...m.decisionPartition];
    demand(
      new Set(cells.map((c) => `${c.id}/${c.symbolGroupId}/${c.direction}`))
        .size === 99,
      'Duplicate matrix cells',
    );
    demand(
      cells.every((c) => ['COMPLETE', 'UNKNOWN'].includes(c.authorityStatus)),
      'Explicit cell authority status required',
    );
  }
  demand(
    ['PASS', 'FAIL', 'UNKNOWN'].includes(report.selectionDecision?.status),
    'Explicit frozen selection decision required',
  );
  demand(
    report.equity?.status !== 'verified-empty' ||
      (report.equity.stream === null && report.equity.rows === 0),
    'No invented zero equity samples',
  );
  canonicalJson(report);
  return report;
};

// Builder/renderer consume the same checked small-report contract. Neither
// creates runtime authority from a core export, a posthoc subset or a file name.
export const loadExecutedCompositionReport = async ({
  projectRoot,
  authority,
  report,
  receipt,
}) => {
  const [a, r, proof] = await Promise.all(
    [authority, report, receipt].map((d) =>
      readExecutedDescriptor(projectRoot, d),
    ),
  );
  validateExecutedCompositionReport(r.value);
  demand(
    a.value.schema === 'tradejs-executed-composition-authority/v1' &&
      a.value.executionBasis === 'closed-loop-execution',
    'Actual authority required',
  );
  demand(
    proof.value.schema === 'tradejs-executed-composition-report-receipt/v1' &&
      proof.value.status === 'derived-inputs-unchanged' &&
      proof.value.inputStabilityVerified === true &&
      same(proof.value.authority, authority) &&
      same(proof.value.report, report) &&
      same(r.value.authority, authority),
    'Executed report/receipt/authority mismatch',
  );
  demand(
    proof.value.metricImplementation?.sha256 === (await hashFile(SELF)).sha256,
    'Executed metric implementation checksum mismatch',
  );
  for (const key of [
    'candidateId',
    'compositionId',
    'researchId',
    'actualBacktestRunId',
  ])
    demand(a.value[key] === r.value[key], 'Executed report identity mismatch');
  for (const ref of r.value.inputs)
    demand(
      (await hashFile(boundPath(projectRoot, ref.path))).sha256 === ref.sha256,
      'Executed report input checksum mismatch',
    );
  const cells = r.value.matrices.observed.decisionPartition,
    stressCells = r.value.matrices.stress20bps.decisionPartition;
  const criterion = (m) =>
    m.find(
      (c) =>
        c.id === 'OUTER_TEST_FROZEN' &&
        c.symbolGroupId === 'ALL_UNIVERSE' &&
        c.direction === 'ALL',
    );
  demand(
    same(
      r.value.selectionDecision,
      evaluateFrozenCompositionCriteria(
        criterion(cells),
        criterion(stressCells),
        r.value.frozenCriteria,
        r.value.blockers,
      ),
    ),
    'Stored frozen criteria result mismatch',
  );
  return { authority: a.value, report: r.value, receipt: proof.value };
};

export const resolveExecutedSelection = (candidates, preRun) => {
  demand(
    preRun &&
      Array.isArray(preRun.candidateIds) &&
      !['selectedId', 'statuses', 'metrics'].some((k) =>
        Object.hasOwn(preRun, k),
      ),
    'Pre-run selection authority must not contain future selection',
  );
  demand(
    same(
      candidates.map((c) => c.id),
      preRun.candidateIds,
    ),
    'Frozen ordered candidate universe mismatch',
  );
  const eligible = candidates.filter(
    (c) =>
      !(c.role === 'baseline' && preRun.baselineSelectionEligible === false),
  );
  demand(eligible.length > 0, 'No selection-eligible candidate universe');
  if (eligible.some((c) => c.selectionDecision.status === 'UNKNOWN'))
    return {
      selectedId: null,
      selectionDisposition: 'authority-blocked',
      finalSelectable: false,
    };
  const passed = eligible.filter((c) => c.selectionDecision.status === 'PASS');
  if (!passed.length)
    return {
      selectedId: null,
      selectionDisposition: 'no-eligible-composition',
      finalSelectable: true,
    };
  const order = preRun.tieBreaker?.orderedTrainCandidateIds;
  demand(
    Array.isArray(order) &&
      new Set(order).size === order.length &&
      order.length === preRun.candidateIds.length &&
      order.every((id) => preRun.candidateIds.includes(id)),
    'Frozen train-only total tie-break order required',
  );
  return {
    selectedId: order.find((id) => passed.some((c) => c.id === id)),
    selectionDisposition: 'selected',
    finalSelectable: true,
  };
};

export const readExecutedEquity = async function* (projectRoot, equity) {
  if (equity.status === 'verified-empty') {
    demand(equity.stream === null && equity.rows === 0, 'Invalid zero equity');
    return;
  }
  if (equity.status === 'unavailable') {
    demand(
      equity.stream === null,
      'Unavailable equity cannot carry invented observations',
    );
    return;
  }
  demand(
    equity.status === 'observed-exit-groups' &&
      equity.stream &&
      integer(equity.rows) &&
      equity.rows > 0,
    'Observed equity descriptor required',
  );
  let prior = -Infinity,
    n = 0;
  for await (const { row } of readStorageManifest({
    projectRoot,
    descriptor: equity.stream,
    authority: equity.authority,
    expectedStorage: equity.storage,
  })) {
    demand(
      integer(row.timestamp) && row.timestamp > prior && finite(row.pnl),
      'Invalid observed exit equity sequence',
    );
    prior = row.timestamp;
    n++;
    yield [row.timestamp, row.pnl];
  }
  demand(n === equity.rows, 'Observed equity row count mismatch');
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    demand(
      ['--projectRoot', '--authority', '--outputPrefix'].includes(argv[i]) &&
        argv[i + 1],
      'Expected --projectRoot --authority --outputPrefix',
    );
    options[argv[i].slice(2)] = argv[++i];
  }
  demand(
    options.projectRoot && options.authority && options.outputPrefix,
    'Required projectRoot/authority/outputPrefix',
  );
  const ref = {
    path: options.authority,
    sha256: (await hashFile(boundPath(options.projectRoot, options.authority)))
      .sha256,
  };
  const result = await deriveExecutedCompositionReport({
    ...options,
    descriptor: ref,
  });
  process.stdout.write(
    canonicalJson({
      report: result.reportDescriptor,
      receipt: result.receiptDescriptor,
      status: result.report.selectionDecision.status,
    }) + '\n',
  );
};
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
