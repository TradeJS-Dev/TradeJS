import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork, execFileSync } from 'node:child_process';
import {
  checkActivation,
  installEntryGateBridge,
  validateExecutionObservationOptions,
  secretFreeProcessReceipt,
  verifyExecutionObservationModules,
} from './research-entry-gate-bridge.mjs';
import {
  canonicalJson,
  objectSha256,
  sha256,
} from './decision-capture-join.mjs';
import {
  createShardedCaptureSink,
  readStorageManifest,
} from './decision-capture-storage.mjs';

const setup = (mode = 'current', quality = 4, direction = 'LONG') => {
  const resolved = { INTERVAL: '15', MIN_AI_QUALITY: 4 };
  const composition = {
    mode,
    strategyName: 'LiquidityZones',
    researchRunId: 'actual-run',
    configId: 'one-config',
    backtestTestKeys: ['test-key'],
    symbols: ['BTCUSDT'],
    windowStart: 0,
    windowEnd: 100,
    config: {
      resolved,
      sha256: objectSha256(resolved),
      minAiQuality: 4,
      nativeMinQuality: 4,
      interval: '15',
      directionPolicy: 'both',
    },
  };
  const signal = {
    signalId: 'signal-one',
    symbol: 'BTCUSDT',
    direction,
    timestamp: 10,
    interval: '15',
    strategy: 'LiquidityZones',
    prices: { currentPrice: 100, stopLossPrice: 99, takeProfitPrice: 102 },
    figures: {},
    indicators: {},
    additionalIndicators: { context: { ma: 101 } },
  };
  const params = {
    ctx: {
      env: 'BACKTEST',
      strategyName: 'LiquidityZones',
      strategyConfig: resolved,
    },
    decision: { kind: 'entry', signal },
    entry: { signal },
    policy: { minAiQuality: 4 },
  };
  const records = [];
  const manifest = { name: 'LiquidityZones' };
  const publicAi = {
    buildAiPayload: (value) => ({
      signal: {
        ...value,
        figures: undefined,
        indicators: undefined,
        additionalIndicators: undefined,
      },
      figures: value.figures,
      indicators: value.indicators,
      additionalIndicators: value.additionalIndicators,
    }),
    runAiPromptLocal: async (value) => ({
      direction: value.direction,
      quality,
    }),
  };
  const options = {
    manifest,
    composition,
    compositionSha256: 'a'.repeat(64),
    publicAi,
    collectFeatures: (payload) => ({
      price: payload.signal.prices.currentPrice,
      ma: payload.additionalIndicators.context.ma,
    }),
    sink: { append: (record) => records.push(record), close() {} },
    observation: { sha256: 'b'.repeat(64) },
  };
  const controller = installEntryGateBridge(options);
  const capture = async () => {
    await manifest.hooks.afterBarDecision(params);
    await manifest.hooks.afterEnrichAi(params);
  };
  return { ...options, signal, params, records, controller, capture };
};

for (const mode of ['capture-pass-all', 'current', 'reject-all'])
  test(`opt-in compressed public ${mode} pipeline preserves END/hooks/payload and synchronous close`, async (t) => {
    const f = setup(mode);
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bridge-storage-'),
    );
    t.after(() => fs.rmSync(projectRoot, { recursive: true }));
    const helper = fileURLToPath(
      new URL('./decision-capture-storage.mjs', import.meta.url),
    );
    const storage = {
      schema: 'tradejs-capture-stream-storage/v1',
      maxShardBytes: 8192,
      maxLineBytes: 4096,
      maxArchiveBytes: 16384,
      reclaimPlain: false,
      helperSha256: sha256(fs.readFileSync(helper)),
    };
    const composition = { ...f.composition, storage };
    const authority = {
      researchRunId: composition.researchRunId,
      configId: composition.configId,
      sourceConfigSha256: composition.config.sha256,
      compositionSha256: f.compositionSha256,
      strategyName: composition.strategyName,
      symbols: composition.symbols,
      windowStart: composition.windowStart,
      windowEnd: composition.windowEnd,
    };
    const sink = createShardedCaptureSink({
      projectRoot,
      outputPath: 'own',
      authority,
      workerObservation: f.observation,
      storage,
    });
    const manifest = { name: 'LiquidityZones' };
    let originalHooks = 0;
    manifest.hooks = {
      afterBarDecision: () => originalHooks++,
      afterEnrichAi: () => originalHooks++,
    };
    const controller = installEntryGateBridge({
      ...f,
      manifest,
      composition,
      sink,
    });
    f.signal.timestamp = 100;
    await manifest.hooks.afterBarDecision(f.params);
    await manifest.hooks.afterEnrichAi(f.params);
    const decision = await manifest.hooks.beforeEntryGate(f.params);
    assert.equal(decision.allow, mode !== 'reject-all');
    assert.equal(originalHooks, 2);
    f.signal.additionalIndicators.context.ma = 999;
    controller.close();
    const descriptor = {
      path: 'own.storage.json',
      sha256: sha256(
        fs.readFileSync(path.join(projectRoot, 'own.storage.json')),
      ),
    };
    const rows = [];
    for await (const line of readStorageManifest({
      projectRoot,
      descriptor,
      authority,
      expectedStorage: storage,
    }))
      rows.push(line.row);
    assert.equal(rows.length, 3);
    assert.equal(rows[1].payload.additionalIndicators.context.ma, 101);
    assert.equal(rows[1].disposition, 'terminal-diagnostic-only');
    assert.equal(rows[2].allow, decision.allow);
  });

test('invalid storage opt-in cannot modify an existing public manifest', () => {
  const f = setup();
  const prior = f.manifest.hooks;
  assert.throws(
    () =>
      installEntryGateBridge({
        ...f,
        composition: { ...f.composition, storage: { schema: 'wrong' } },
      }),
    /storage authority/,
  );
  assert.equal(f.manifest.hooks, prior);
});
for (const mode of ['capture-pass-all', 'current', 'reject-all', 'replacement'])
  test(`${mode} immutable decision snapshot and gate fixture`, async () => {
    const f = setup(mode);
    await f.capture();
    const verdict = await f.manifest.hooks.beforeEntryGate(f.params);
    assert.equal(verdict.allow, mode !== 'reject-all');
    const capture = f.records.find(
      (row) => row.schema === 'tradejs-research-decision-capture/v1',
    );
    f.signal.prices.currentPrice = 999;
    f.signal.additionalIndicators.context.ma = -999;
    assert.equal(capture.payload.signal.prices.currentPrice, 100);
    assert.equal(capture.payload.additionalIndicators.context.ma, 101);
    assert.throws(() => {
      capture.payload.signal.prices.currentPrice = 1;
    }, TypeError);
    await assert.rejects(f.manifest.hooks.beforeEntryGate(f.params), /parity/);
  });
for (const [quality, allowed] of [
  [3.49, false],
  [3.5, true],
  [4, true],
  ['4', false],
  [null, false],
])
  test(`numeric runtime quality ${quality}`, async () => {
    const f = setup('current', quality);
    await f.capture();
    assert.equal(
      (await f.manifest.hooks.beforeEntryGate(f.params)).allow,
      allowed,
    );
  });
test('current disabled gate is not reopened by quality, replacement explicit final decision', async () => {
  const f = setup();
  f.publicAi.runAiPromptLocal = async () => ({
    direction: null,
    quality: 3,
    approved: false,
  });
  await f.capture();
  assert.equal((await f.manifest.hooks.beforeEntryGate(f.params)).allow, false);
});
test('native/effective threshold mismatch and policy profiles block', () => {
  const f = setup();
  const other = {
    ...f.options,
    ...f,
    manifest: { name: 'LiquidityZones' },
    composition: {
      ...f.composition,
      config: { ...f.composition.config, nativeMinQuality: 3 },
    },
  };
  assert.throws(() => installEntryGateBridge(other), /threshold/);
  assert.throws(
    () =>
      installEntryGateBridge({
        ...f,
        manifest: { name: 'LiquidityZones', policyProfiles: [{ id: 'x' }] },
      }),
    /profile/,
  );
});
test('idempotence, missing capture, duplicate and changed config fail closed', async () => {
  const f = setup();
  assert.equal(installEntryGateBridge(f), f.controller);
  assert.throws(
    () => installEntryGateBridge({ ...f, compositionSha256: 'c'.repeat(64) }),
    /Conflicting/,
  );
  await assert.rejects(f.manifest.hooks.beforeEntryGate(f.params), /parity/);
  await f.capture();
  await assert.rejects(f.manifest.hooks.afterEnrichAi(f.params), /duplicate/);
  f.params.ctx.strategyConfig = {};
  await assert.rejects(f.manifest.hooks.beforeEntryGate(f.params), /binding/);
});
test('old factory captured manifest sees hook replacement and prior veto preserved', async () => {
  const f = setup();
  const creator = () => f.manifest.hooks.beforeEntryGate;
  await f.capture();
  assert.equal(creator(), f.controller.hook);
  assert.equal((await creator()(f.params)).allow, true);
});
test('inactive boundary does not read nonexistent composition for native/coordinator', () => {
  for (const argv of [
    ['node', '/fake/aiTrain.js'],
    ['node', '/fake/backtest.js'],
    ['node', '/fake/yarn.js'],
  ])
    assert.equal(
      checkActivation({
        argv,
        cwd: '/nonexistent',
        env: { TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION: '/missing' },
      }),
      null,
    );
  assert.throws(
    () =>
      checkActivation({
        argv: ['node', '/fake/testerWorker.js'],
        env: { TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION: '/missing' },
      }),
    /SHA/,
  );
});
test('exact tester activation binds bytes/root/hash/actual run and rejects foreign path', (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'entry-activation-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'node_modules/@tradejs/cli/dist/workers'), {
    recursive: true,
  });
  const worker = path.join(
    root,
    'node_modules/@tradejs/cli/dist/workers/testerWorker.js',
  );
  fs.writeFileSync(worker, 'fixture worker');
  const composition = {
    schema: 'tradejs-research-entry-gate-composition/v1',
    projectRoot: root,
    workerSha256: sha256(fs.readFileSync(worker)),
    researchRunId: 'run',
  };
  const file = path.join(root, 'composition.json');
  fs.writeFileSync(file, JSON.stringify(composition));
  const env = {
    TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION: file,
    TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION_SHA256: sha256(
      fs.readFileSync(file),
    ),
    TRADEJS_RESEARCH_RUN_ID: 'run',
  };
  assert.equal(
    checkActivation({ cwd: root, argv: ['node', worker], env }).composition
      .researchRunId,
    'run',
  );
  assert.throws(
    () =>
      checkActivation({
        cwd: root,
        argv: ['node', worker],
        env: { ...env, TRADEJS_RESEARCH_RUN_ID: 'wrong' },
      }),
    /run binding/,
  );
  fs.appendFileSync(file, ' ');
  assert.throws(
    () => checkActivation({ cwd: root, argv: ['node', worker], env }),
    /SHA mismatch/,
  );
});
test('synthetic public CJS/ESM registry singleton shares manifest after factory lookup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.writeFileSync(
    path.join(root, 'shared.cjs'),
    'module.exports={manifest:{name:"LiquidityZones"}};',
  );
  fs.writeFileSync(
    path.join(root, 'registry.cjs'),
    'const s=require("./shared.cjs");exports.getStrategyManifest=()=>s.manifest;',
  );
  fs.writeFileSync(
    path.join(root, 'registry.mjs'),
    'import s from "./shared.cjs";export const getStrategyManifest=()=>s.manifest;',
  );
  const cjs = createRequire(path.join(root, 'anchor.js'))('./registry.cjs');
  const esm = await import(pathToFileURL(path.join(root, 'registry.mjs')));
  assert.equal(cjs.getStrategyManifest(), esm.getStrategyManifest());
  const factoryManifest = cjs.getStrategyManifest();
  esm.getStrategyManifest().hooks = {
    beforeEntryGate: () => ({ allow: false }),
  };
  assert.equal(factoryManifest.hooks.beforeEntryGate().allow, false);
});
test('NODE_OPTIONS preload reaches synthetic tester fork despite replaced execArgv', async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'preload-fork-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'node_modules/@tradejs/cli/dist/workers'), {
    recursive: true,
  });
  const worker = path.join(
    root,
    'node_modules/@tradejs/cli/dist/workers/testerWorker.js',
  );
  fs.writeFileSync(worker, 'process.send({fixture:true});process.exit(0);');
  const composition = {
    schema: 'tradejs-research-entry-gate-composition/v1',
    projectRoot: root,
    workerSha256: sha256(fs.readFileSync(worker)),
    researchRunId: 'external',
  };
  const file = path.join(root, 'composition.json');
  fs.writeFileSync(file, JSON.stringify(composition));
  const activationEnv = {
    TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION: file,
    TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION_SHA256: sha256(
      fs.readFileSync(file),
    ),
    TRADEJS_RESEARCH_RUN_ID: 'external',
  };
  const preload = path.join(root, 'fixture-preload.mjs');
  const marker = path.join(root, 'marker.json');
  fs.writeFileSync(
    preload,
    `import fs from 'node:fs';import {checkActivation} from ${JSON.stringify(new URL('./research-entry-gate-bridge.mjs', import.meta.url).href)};fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify(checkActivation({env:JSON.parse(process.env.SYNTHETIC_ACTIVATION)})),{flag:'wx'});`,
  );
  const env = {
    ...process.env,
    NODE_OPTIONS: `--import=${preload}`,
    SYNTHETIC_ACTIVATION: JSON.stringify(activationEnv),
  };
  delete env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION;
  const child = fork(worker, [], {
    cwd: root,
    env,
    execArgv: [],
    silent: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0);
  assert.equal(
    JSON.parse(fs.readFileSync(marker)).composition.researchRunId,
    'external',
  );
});
test('capture-pass-all never calls local evaluator; SHORT direction/native reconstruction parity', async () => {
  const f = setup('capture-pass-all', 4, 'SHORT');
  f.publicAi.runAiPromptLocal = () => {
    throw Error('must not evaluate');
  };
  await f.capture();
  assert.equal((await f.manifest.hooks.beforeEntryGate(f.params)).allow, true);
  const gated = setup('current', 4, 'SHORT');
  let observed;
  gated.publicAi.runAiPromptLocal = async (signal) => {
    observed = signal;
    return { quality: 4, direction: 'SHORT' };
  };
  await gated.capture();
  assert.equal(
    (await gated.manifest.hooks.beforeEntryGate(gated.params)).allow,
    true,
  );
  assert.equal(observed.direction, 'SHORT');
  assert.equal(observed.prices.currentPrice, 100);
});
test('frozen adapter replacement drift and fractional effective threshold blocked', async () => {
  const f = setup();
  await f.capture();
  f.manifest.aiAdapter = {};
  await assert.rejects(
    f.manifest.hooks.beforeEntryGate(f.params),
    /binding changed/,
  );
  const other = setup();
  const resolved = {
    ...other.composition.config.resolved,
    MIN_AI_QUALITY: 3.5,
  };
  assert.throws(
    () =>
      installEntryGateBridge({
        ...other,
        manifest: { name: 'LiquidityZones' },
        composition: {
          ...other.composition,
          config: {
            ...other.composition.config,
            resolved,
            sha256: objectSha256(resolved),
            minAiQuality: 3.5,
            nativeMinQuality: 3.5,
          },
        },
      }),
    /threshold/,
  );
});
for (const mode of ['capture-pass-all', 'current', 'reject-all', 'replacement'])
  test(`${mode} public pipeline keeps exact END decision diagnostic without gate bypass`, async () => {
    const f = setup(mode);
    f.signal.timestamp = 100;
    await f.capture();
    const verdict = await f.manifest.hooks.beforeEntryGate(f.params);
    assert.equal(verdict.allow, mode !== 'reject-all');
    assert.equal(f.records.length, 3);
    assert.ok(
      f.records.every((row) => row.disposition === 'terminal-diagnostic-only'),
    );
    assert.equal(f.controller.counts().pending, 0);
    assert.equal(f.records[1].payload.signal.timestamp, 100);
    f.signal.timestamp = 101;
    await assert.rejects(
      f.manifest.hooks.afterBarDecision(f.params),
      /binding/,
    );
  });
test('completed gates release heavy snapshots but retain duplicate protection', async () => {
  const f = setup();
  for (let i = 0; i < 10; i++) {
    f.signal.signalId = `signal-${i}`;
    await f.capture();
    await f.manifest.hooks.beforeEntryGate(f.params);
    assert.equal(f.controller.counts().pending, 0);
  }
  assert.equal(f.controller.counts().captures, 10);
  await assert.rejects(
    f.manifest.hooks.afterBarDecision(f.params),
    /Duplicate/,
  );
});
test('bridge identity byte bound blocks without changing gate thresholds', async () => {
  const f = setup();
  const manifest = { name: 'LiquidityZones' };
  installEntryGateBridge({
    ...f,
    manifest,
    composition: { ...f.composition, resources: { maxIndexBytes: 1 } },
  });
  await assert.rejects(
    manifest.hooks.afterBarDecision(f.params),
    /resource bound/,
  );
});

const executionOptions = () => ({
  schema: 'tradejs-entry-execution-observations/v1',
  enabled: true,
  runtimeVersion: '3.1.29-beta.268',
  runtimeModule: {
    relativePath: 'dist/chunk-SKY2HNZU.mjs',
    sha256: 'a471d1def1ca8f8ae5956539ae5de6efbe909f5f03d2b012b29c4e819dba003e',
  },
  publicModule: {
    relativePath: 'dist/strategies.mjs',
    sha256: 'fe4c6de6260ca322060d3128caa5020792064a123ba879aa21155cb783dfb768',
  },
  typesModule: {
    relativePath: 'dist/index.d.ts',
    sha256: '4cfa0d2af91b3e37d51d7cdf7f7f8d8d9245535adfbec931850b79063385e9d3',
  },
  maxPendingInvocations: 2,
  maxPendingBytes: 8192,
  maxIdentityBytes: 256,
  maxResultBytes: 1024,
});
const executionFixture = (overrides = {}, hooks = {}) => {
  const f = setup('capture-pass-all');
  const executions = [];
  let aborted = false,
    closed = false,
    failed = false;
  const manifest = { name: 'LiquidityZones', hooks };
  const composition = {
    ...f.composition,
    storage: {
      schema: 'tradejs-capture-stream-storage/v1',
      helperSha256: 'd'.repeat(64),
      reclaimPlain: false,
    },
    executionObservations: { ...executionOptions(), ...overrides },
  };
  const controller = installEntryGateBridge({
    ...f,
    manifest,
    composition,
    executionSink: {
      append: (r) => executions.push(r),
      abort: () => {
        aborted = true;
      },
      close: () => {
        closed = true;
      },
    },
    onExecutionFailure: () => {
      failed = true;
    },
  });
  return {
    ...f,
    manifest,
    composition,
    controller,
    executions,
    state: () => ({ aborted, closed, failed }),
    capture: async () => {
      await manifest.hooks.afterBarDecision(f.params);
      await manifest.hooks.afterEnrichAi(f.params);
    },
  };
};
test('execution option requires explicit storage/schema/version/modules/positive bounds', () => {
  const f = executionFixture();
  assert.ok(validateExecutionObservationOptions(f.composition));
  for (const bad of [
    { storage: undefined },
    { executionObservations: { ...executionOptions(), enabled: false } },
    { executionObservations: { ...executionOptions(), maxPendingBytes: 0 } },
    {
      executionObservations: { ...executionOptions(), runtimeVersion: 'other' },
    },
  ])
    assert.throws(() =>
      validateExecutionObservationOptions({ ...f.composition, ...bad }),
    );
});
for (const delay of [0, 1])
  test(
    'compact invocation survives modeled delay ' +
      delay +
      ' without future payload rebuilding',
    async () => {
      const calls = [];
      const f = executionFixture(
        {},
        {
          beforePlaceOrder: async (p) => {
            await Promise.resolve();
            calls.push(['before', p]);
          },
          afterPlaceOrder: async (p) => {
            await Promise.resolve();
            calls.push(['after', p]);
          },
        },
      );
      await f.capture();
      await f.manifest.hooks.beforeEntryGate(f.params);
      const payloadHash = f.records[1].payloadSha256;
      const params = {
        ...f.params,
        market: { candle: { timestamp: 10 + delay * 900000 } },
        order: { result: f.signal },
      };
      f.signal.prices.currentPrice = 777;
      f.signal.additionalIndicators.context.ma = 999;
      await f.manifest.hooks.beforePlaceOrder(params);
      await f.manifest.hooks.afterPlaceOrder(params);
      f.controller.close();
      assert.deepEqual(
        calls.map((x) => x[0]),
        ['before', 'after'],
      );
      assert.ok(calls.every((x) => x[1] === params));
      assert.deepEqual(
        f.executions.map((x) => x.stage),
        [
          'gate-invocation-link',
          'before-place-order-attempt',
          'after-place-order-executed',
          'closure-unresolved',
        ],
      );
      assert.ok(
        f.executions.slice(0, 3).every((x) => x.payloadSha256 === payloadHash),
      );
      assert.ok(
        f.executions
          .slice(0, 3)
          .every((x) => x.invocationId === f.executions[0].invocationId),
      );
      assert.deepEqual(f.executions.at(-1).unresolved, []);
      assert.equal(f.controller.counts().executionPending, 0);
      assert.equal(f.executions[2].fillGeometryAuthority, false);
      assert.equal(f.executions[2].observedResult.kind, 'signal');
      const gate = f.records.find(
        (r) => r.schema === 'tradejs-entry-gate-observation/v1',
      );
      assert.equal(f.executions[0].gateObservationSha256, objectSha256(gate));
      assert.deepEqual(
        f.executions.map((r) => r.observationSequence),
        [0, 1, 2, 3],
      );
      assert.ok(
        f.executions
          .slice(0, 3)
          .every((r) => r.workerObservationSha256 === f.observation.sha256),
      );
      assert.notEqual(
        f.executions[0].gateObservationSha256,
        sha256(canonicalJson(gate) + '\n'),
      );
    },
  );
test('prior manifest veto stays exact and outside own gate coverage', async () => {
  const veto = { allow: false, reason: 'PRIOR' };
  let calls = 0;
  const f = executionFixture(
    {},
    {
      beforeEntryGate: async () => {
        calls++;
        return veto;
      },
    },
  );
  await f.capture();
  assert.equal(await f.manifest.hooks.beforeEntryGate(f.params), veto);
  f.controller.close();
  assert.equal(calls, 1);
  assert.equal(f.executions[0].ownGateCalled, false);
  assert.equal(f.executions[0].priorManifestVeto, true);
  assert.equal(f.executions[0].gateObservationSha256, null);
  assert.equal(
    f.executions[0].gateObservationStatus,
    'absent-prior-manifest-veto',
  );
  assert.equal(f.records.length, 2);
});
test('modeled Project veto is not claimed as manifest gate call', async () => {
  const f = executionFixture();
  await f.capture();
  f.signal.signalId = 'later-project-decision';
  await f.capture();
  f.controller.close();
  assert.deepEqual(
    f.executions.map((x) => x.stage),
    ['closure-unresolved'],
  );
  assert.equal(f.executions[0].capturedWithoutManifestGate, 2);
});
test('pending delayed rejected/unresolved is explicit, never a fake execution', async () => {
  const f = executionFixture();
  await f.capture();
  await f.manifest.hooks.beforeEntryGate(f.params);
  f.controller.close();
  assert.equal(f.executions.at(-1).unresolved.length, 1);
  assert.equal(f.executions.at(-1).unresolved[0].attempted, false);
  assert.equal(
    f.executions.filter((x) => x.stage === 'after-place-order-executed').length,
    0,
  );
});
test('own blocked gate has checksum-bound link but no attempt/execution chain', async () => {
  const f = executionFixture();
  const manifest = { name: 'LiquidityZones' };
  const rows = [];
  const controller = installEntryGateBridge({
    ...f,
    manifest,
    composition: { ...f.composition, mode: 'reject-all' },
    executionSink: { append: (r) => rows.push(r), close() {}, abort() {} },
  });
  await manifest.hooks.afterBarDecision(f.params);
  await manifest.hooks.afterEnrichAi(f.params);
  assert.equal((await manifest.hooks.beforeEntryGate(f.params)).allow, false);
  controller.close();
  const gate = f.records.find(
    (r) => r.schema === 'tradejs-entry-gate-observation/v1',
  );
  assert.equal(gate.allow, false);
  assert.equal(rows[0].ownGateCalled, true);
  assert.equal(rows[0].gateObservationSha256, objectSha256(gate));
  assert.equal(rows[0].gateObservationStatus, 'own-gate-observed');
  assert.deepEqual(
    rows.map((r) => r.stage),
    ['gate-invocation-link', 'closure-unresolved'],
  );
  assert.deepEqual(
    rows.map((r) => r.observationSequence),
    [0, 1],
  );
});
test('gate checksum detects altered bytes, and interleaved invocations retain monotone sequence', async () => {
  const f = executionFixture();
  await f.capture();
  await f.manifest.hooks.beforeEntryGate(f.params);
  const gate = f.records.find(
    (r) => r.schema === 'tradejs-entry-gate-observation/v1',
  );
  assert.equal(f.executions[0].gateObservationSha256, objectSha256(gate));
  assert.notEqual(
    objectSha256({ ...gate, allow: !gate.allow }),
    f.executions[0].gateObservationSha256,
  );
  const first = {
    ...f.params,
    decision: { ...f.params.decision },
    entry: { ...f.params.entry },
    market: { candle: { timestamp: 10 } },
    order: { result: f.signal },
  };
  const oldSignal = f.signal;
  f.params.decision = {
    ...f.params.decision,
    signal: { ...oldSignal, signalId: 'next' },
  };
  f.params.entry = { signal: f.params.decision.signal };
  await f.capture();
  await f.manifest.hooks.beforeEntryGate(f.params);
  await f.manifest.hooks.beforePlaceOrder(first);
  await f.manifest.hooks.afterPlaceOrder(first);
  assert.deepEqual(
    f.executions.map((r) => r.observationSequence),
    [0, 1, 2, 3],
  );
  assert.equal(f.executions[2].invocationId, f.executions[0].invocationId);
  assert.equal(f.executions[3].invocationId, f.executions[0].invocationId);
  f.controller.close();
});
test('new stage failure aborts authority despite modeled runtime swallowing exception', async () => {
  const f = executionFixture(
    {},
    {
      beforePlaceOrder: async () => {
        throw Error('synthetic prior error');
      },
    },
  );
  await f.capture();
  await f.manifest.hooks.beforeEntryGate(f.params);
  await assert.rejects(
    f.manifest.hooks.beforePlaceOrder({
      ...f.params,
      market: { candle: { timestamp: 10 } },
    }),
  );
  assert.deepEqual(f.state(), { aborted: true, closed: false, failed: true });
  assert.throws(() => f.controller.close(), /no COMPLETE/);
});
for (const overrides of [
  { maxPendingInvocations: 1 },
  { maxPendingBytes: 1 },
  { maxIdentityBytes: 1 },
])
  test(
    'execution pending identity bound ' + JSON.stringify(overrides),
    async () => {
      const f = executionFixture(overrides);
      await f.capture();
      if (overrides.maxPendingInvocations) {
        await f.manifest.hooks.beforeEntryGate(f.params);
        f.signal.signalId = 'second';
        await f.capture();
      }
      await assert.rejects(f.manifest.hooks.beforeEntryGate(f.params), /bound/);
      assert.equal(f.state().failed, true);
      assert.throws(() => f.controller.close(), /COMPLETE/);
    },
  );
test('public string result and duplicate/mismatch result fail closed', async () => {
  const f = executionFixture();
  await f.capture();
  await f.manifest.hooks.beforeEntryGate(f.params);
  const p = {
    ...f.params,
    market: { candle: { timestamp: 10 } },
    order: { result: 'PUBLIC_CODE' },
  };
  await f.manifest.hooks.beforePlaceOrder(p);
  await f.manifest.hooks.afterPlaceOrder(p);
  assert.deepEqual(f.executions[2].observedResult, {
    kind: 'string',
    value: 'PUBLIC_CODE',
  });
  await assert.rejects(f.manifest.hooks.afterPlaceOrder(p), /binding/);
  assert.equal(f.state().failed, true);
});
test('opt-in process receipt exposes no argv, env, or commandLine', () => {
  const receipt = secretFreeProcessReceipt();
  assert.deepEqual(Object.keys(receipt).sort(), [
    'comm',
    'nodeVersion',
    'pid',
    'ppid',
    'rss',
  ]);
  assert.equal(receipt.nodeVersion, process.versions.node);
  assert.ok(receipt.rss > 0);
});
test('parallel execution stages use accepted bounded storage manifest, including END diagnostic', async (t) => {
  const f = executionFixture();
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'execution-storage-unit-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true }));
  const helper = fileURLToPath(
    new URL('./decision-capture-storage.mjs', import.meta.url),
  );
  const storage = {
    schema: 'tradejs-capture-stream-storage/v1',
    helperSha256: sha256(fs.readFileSync(helper)),
    reclaimPlain: false,
    maxShardBytes: 8192,
    maxLineBytes: 4096,
    maxArchiveBytes: 16384,
  };
  const composition = { ...f.composition, storage };
  const manifest = { name: 'LiquidityZones' };
  const authority = f.controller.authority;
  const sink = createShardedCaptureSink({
    projectRoot: root,
    outputPath: 'execution',
    authority,
    workerObservation: f.observation,
    storage,
  });
  const controller = installEntryGateBridge({
    ...f,
    manifest,
    composition,
    executionSink: sink,
  });
  f.signal.timestamp = 100;
  await manifest.hooks.afterBarDecision(f.params);
  await manifest.hooks.afterEnrichAi(f.params);
  await manifest.hooks.beforeEntryGate(f.params);
  const p = {
    ...f.params,
    market: { candle: { timestamp: 100 } },
    order: { result: f.signal },
  };
  await manifest.hooks.beforePlaceOrder(p);
  await manifest.hooks.afterPlaceOrder(p);
  controller.close();
  const descriptor = {
    path: 'execution.storage.json',
    sha256: sha256(fs.readFileSync(path.join(root, 'execution.storage.json'))),
  };
  const rows = [];
  for await (const value of readStorageManifest({
    projectRoot: root,
    descriptor,
    authority,
    expectedStorage: storage,
  }))
    rows.push(value.row);
  assert.equal(rows.length, 4);
  assert.ok(
    rows.slice(0, 3).every((x) => x.disposition === 'terminal-diagnostic-only'),
  );
  assert.equal(rows[3].unresolved.length, 0);
});
test('default and storage-only capture bytes match independent accepted frozen golden', async () => {
  const golden =
    '[{"compositionSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","configId":"one-config","disposition":"strict-window","researchRunId":"actual-run","schema":"tradejs-entry-inventory/v1","signalId":"signal-one","sourceConfigSha256":"d4fc120979de7adb412ebbf4bbe63627bda9a134d1ddd277fe105a3456729ec0","strategyName":"LiquidityZones","symbol":"BTCUSDT","symbols":["BTCUSDT"],"timestamp":10,"windowEnd":100,"windowStart":0},{"captureSequence":0,"compositionSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","configId":"one-config","direction":"LONG","disposition":"strict-window","featureSha256":"349a4ffe155961e0b603a530c745532646dda1e31a18ad5350788d7bade99303","payload":{"additionalIndicators":{"context":{"ma":101}},"figures":{},"indicators":{},"signal":{"direction":"LONG","interval":"15","prices":{"currentPrice":100,"stopLossPrice":99,"takeProfitPrice":102},"signalId":"signal-one","strategy":"LiquidityZones","symbol":"BTCUSDT","timestamp":10}},"payloadSha256":"b3394d2937d4a52b8f093f5f46422e5800b163cd0ab2aa65963e7e83126ae3db","researchRunId":"actual-run","schema":"tradejs-research-decision-capture/v1","signalId":"signal-one","signalSha256":"3bc42a0930a66f152bd41c7d4a36850c09989f50fbed0aaf348b3928da863990","signalSnapshot":{"additionalIndicators":{"context":{"ma":101}},"direction":"LONG","figures":{},"indicators":{},"interval":"15","prices":{"currentPrice":100,"stopLossPrice":99,"takeProfitPrice":102},"signalId":"signal-one","strategy":"LiquidityZones","symbol":"BTCUSDT","timestamp":10},"sourceConfigSha256":"d4fc120979de7adb412ebbf4bbe63627bda9a134d1ddd277fe105a3456729ec0","stage":"afterEnrichAi/prequeue","strategyName":"LiquidityZones","symbol":"BTCUSDT","symbols":["BTCUSDT"],"timestamp":10,"windowEnd":100,"windowStart":0,"workerObservationSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},{"allow":true,"analysis":{},"compositionSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","configId":"one-config","disposition":"strict-window","effectiveMinAiQuality":4,"featureSha256":"349a4ffe155961e0b603a530c745532646dda1e31a18ad5350788d7bade99303","normalizedQuality":null,"payloadSha256":"b3394d2937d4a52b8f093f5f46422e5800b163cd0ab2aa65963e7e83126ae3db","researchRunId":"actual-run","schema":"tradejs-entry-gate-observation/v1","signalId":"signal-one","sourceConfigSha256":"d4fc120979de7adb412ebbf4bbe63627bda9a134d1ddd277fe105a3456729ec0","strategyName":"LiquidityZones","symbol":"BTCUSDT","symbols":["BTCUSDT"],"timestamp":10,"windowEnd":100,"windowStart":0}]';
  assert.equal(
    sha256(golden),
    'fb45cd8974f2a540cfac3923e171bff15600dfdb6f9a444dd84a97aec05d5bd1',
  );
  for (const storage of [
    undefined,
    {
      schema: 'tradejs-capture-stream-storage/v1',
      helperSha256: 'd'.repeat(64),
      reclaimPlain: false,
    },
  ]) {
    const f = setup('capture-pass-all');
    const rows = [];
    const manifest = { name: 'LiquidityZones' };
    installEntryGateBridge({
      ...f,
      manifest,
      composition: { ...f.composition, storage },
      sink: { append: (r) => rows.push(r), close() {} },
    });
    await manifest.hooks.afterBarDecision(f.params);
    await manifest.hooks.afterEnrichAi(f.params);
    await manifest.hooks.beforeEntryGate(f.params);
    assert.equal(canonicalJson(rows), golden);
  }
});
test('module/types version and checksum reject before public runtime import', (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-module-binding-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true }));
  const options = executionOptions();
  for (const [name, pkg] of [
    ['runtimeModule', 'node'],
    ['publicModule', 'node'],
    ['typesModule', 'types'],
  ]) {
    const p = path.join(
      root,
      'node_modules/@tradejs',
      pkg,
      options[name].relativePath,
    );
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, name);
    options[name].sha256 = sha256(Buffer.from(name));
    fs.writeFileSync(
      path.join(root, 'node_modules/@tradejs', pkg, 'package.json'),
      JSON.stringify({ version: '3.1.29-beta.268' }),
    );
  }
  const composition = { storage: {}, executionObservations: options };
  assert.ok(verifyExecutionObservationModules(root, composition));
  options.typesModule.sha256 = '0'.repeat(64);
  assert.throws(
    () => verifyExecutionObservationModules(root, composition),
    /SHA/,
  );
  options.typesModule.sha256 = sha256(Buffer.from('typesModule'));
  fs.writeFileSync(
    path.join(root, 'node_modules/@tradejs/types/package.json'),
    JSON.stringify({ version: '3.1.29-beta.267' }),
  );
  assert.throws(
    () => verifyExecutionObservationModules(root, composition),
    /version/,
  );
});
