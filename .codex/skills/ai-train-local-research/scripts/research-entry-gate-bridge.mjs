import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  boundPath,
  captureDisposition,
  createCaptureSink,
  immutableClone,
  objectSha256,
  sha256,
  writeExclusiveJson,
} from './decision-capture-join.mjs';

export const checkActivation = ({
  env = process.env,
  argv = process.argv,
  cwd = process.cwd(),
} = {}) => {
  // No framework imports/config/plugin I/O on yarn/coordinator/native/export processes.
  if (!argv[1] || path.basename(argv[1]) !== 'testerWorker.js') return null;
  if (!env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION) return null;
  if (
    !/^[a-f0-9]{64}$/.test(
      env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION_SHA256 ?? '',
    )
  )
    throw new Error('Composition SHA required');
  const root = fs.realpathSync(cwd);
  const expectedWorker = boundPath(
    root,
    'node_modules/@tradejs/cli/dist/workers/testerWorker.js',
  );
  if (fs.realpathSync(argv[1]) !== expectedWorker)
    throw new Error('Foreign tester worker');
  const file = boundPath(root, env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION);
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION_SHA256)
    throw new Error('Composition SHA mismatch');
  const composition = JSON.parse(bytes);
  if (
    composition.schema !== 'tradejs-research-entry-gate-composition/v1' ||
    fs.realpathSync(composition.projectRoot) !== root ||
    composition.workerSha256 !== sha256(fs.readFileSync(expectedWorker))
  )
    throw new Error('Composition worker/root mismatch');
  if (composition.researchRunId !== env.TRADEJS_RESEARCH_RUN_ID)
    throw new Error('External research run binding required');
  return {
    composition,
    projectRoot: root,
    compositionSha256: sha256(bytes),
    workerPath: expectedWorker,
  };
};

const number = (value) => typeof value === 'number' && Number.isFinite(value);
export const signalFromCapturedPayload = (payload) => ({
  ...payload.signal,
  strategy: payload.signal.strategy,
  figures: payload.figures ?? {},
  indicators: payload.indicators ?? {},
  additionalIndicators: payload.additionalIndicators ?? {},
  prices: payload.signal.prices,
});
const controllers = new WeakMap();
export const validateExecutionObservationOptions = (composition) => {
  const options = composition.executionObservations;
  if (options === undefined) return null;
  if (
    !composition.storage ||
    options.schema !== 'tradejs-entry-execution-observations/v1' ||
    options.enabled !== true ||
    options.runtimeVersion !== '3.1.29-beta.268'
  )
    throw new Error(
      'Explicit execution observation/storage authority required',
    );
  for (const [name, relativePath] of [
    ['runtimeModule', 'dist/chunk-SKY2HNZU.mjs'],
    ['publicModule', 'dist/strategies.mjs'],
    ['typesModule', 'dist/index.d.ts'],
  ]) {
    const value = options[name];
    if (
      value?.relativePath !== relativePath ||
      !/^[a-f0-9]{64}$/.test(value?.sha256 ?? '')
    )
      throw new Error('Exact execution module/types authority required');
  }
  for (const name of [
    'maxPendingInvocations',
    'maxPendingBytes',
    'maxIdentityBytes',
    'maxResultBytes',
  ])
    if (!Number.isSafeInteger(options[name]) || options[name] <= 0)
      throw new Error('Execution observation resource bounds required');
  return options;
};
export const secretFreeProcessReceipt = () => {
  const comm = execFileSync('ps', ['-p', String(process.pid), '-o', 'comm='], {
    encoding: 'utf8',
    maxBuffer: 4096,
    timeout: 1000,
  }).trim();
  if (!comm || comm.includes('\n') || Buffer.byteLength(comm) > 1024)
    throw new Error('Own process comm unavailable');
  return {
    pid: process.pid,
    ppid: process.ppid,
    rss: process.memoryUsage().rss,
    comm,
    nodeVersion: process.versions.node,
  };
};
export const verifyExecutionObservationModules = (projectRoot, composition) => {
  const options = validateExecutionObservationOptions(composition);
  if (!options) return null;
  const bindings = {};
  for (const [name, pkg] of [
    ['runtimeModule', 'node'],
    ['publicModule', 'node'],
    ['typesModule', 'types'],
  ]) {
    const file = boundPath(
      projectRoot,
      'node_modules/@tradejs/' + pkg + '/' + options[name].relativePath,
    );
    if (sha256(fs.readFileSync(file)) !== options[name].sha256)
      throw new Error('Execution module/types SHA mismatch');
    const version = JSON.parse(
      fs.readFileSync(
        boundPath(
          projectRoot,
          'node_modules/@tradejs/' + pkg + '/package.json',
        ),
      ),
    ).version;
    if (version !== options.runtimeVersion)
      throw new Error('Execution module/types version mismatch');
    bindings[name] = { path: file, sha256: options[name].sha256, version };
  }
  return bindings;
};
export const validateBridgeComposition = (composition) => {
  validateExecutionObservationOptions(composition);
  if (
    composition.storage &&
    (composition.storage.schema !== 'tradejs-capture-stream-storage/v1' ||
      !/^[a-f0-9]{64}$/.test(composition.storage.helperSha256 ?? '') ||
      typeof composition.storage.reclaimPlain !== 'boolean')
  )
    throw new Error('Explicit opt-in storage authority required');
  const config = composition.config;
  if (
    !['capture-pass-all', 'current', 'reject-all', 'replacement'].includes(
      composition.mode,
    )
  )
    throw new Error('Unknown research bridge mode');
  if (
    !config ||
    objectSha256(config.resolved) !== config.sha256 ||
    !Number.isSafeInteger(config.minAiQuality) ||
    config.minAiQuality !== config.nativeMinQuality ||
    config.resolved.MIN_AI_QUALITY !== config.minAiQuality ||
    String(config.resolved.INTERVAL) !== config.interval ||
    !['both', 'direction_aware', 'long_only', 'short_only'].includes(
      config.directionPolicy,
    )
  )
    throw new Error(
      'Explicit equal runtime/native threshold/config binding required',
    );
  if (
    !composition.researchRunId ||
    !composition.configId ||
    !Array.isArray(composition.symbols) ||
    !composition.symbols.length ||
    new Set(composition.symbols).size !== composition.symbols.length ||
    !Number.isSafeInteger(composition.windowStart) ||
    !Number.isSafeInteger(composition.windowEnd) ||
    composition.windowStart >= composition.windowEnd
  )
    throw new Error(
      'Single-config external run/symbol/window binding required',
    );
};
export const installEntryGateBridge = ({
  manifest,
  composition,
  compositionSha256,
  publicAi,
  collectFeatures,
  sink,
  observation,
  executionSink,
  onExecutionFailure,
}) => {
  validateBridgeComposition(composition);
  const executionOptions = validateExecutionObservationOptions(composition);
  if (controllers.has(manifest)) {
    const prior = controllers.get(manifest);
    if (
      prior.compositionSha256 !== compositionSha256 ||
      manifest.hooks?.beforeEntryGate !== prior.hook ||
      manifest.hooks?.afterBarDecision !== prior.inventoryHook ||
      manifest.hooks?.afterEnrichAi !== prior.captureHook ||
      manifest.aiAdapter !== prior.adapter ||
      (executionOptions &&
        (manifest.hooks?.beforePlaceOrder !== prior.beforeOrderHook ||
          manifest.hooks?.afterPlaceOrder !== prior.afterOrderHook))
    )
      throw new Error('Conflicting or changed bridge');
    return prior;
  }
  if (
    executionOptions &&
    (!executionSink?.append || !executionSink?.close || !executionSink?.abort)
  )
    throw new Error('Separate bounded execution storage sink required');
  if (
    manifest.name !== composition.strategyName ||
    manifest.policyProfiles?.length
  )
    throw new Error('Manifest/profile binding mismatch');
  const config = composition.config;
  const priorHooks = manifest.hooks ?? {};
  const snapshots = new Map();
  const inventory = new Set();
  const captured = new Set();
  let retainedIndexBytes = 0;
  const maxIndexRows = composition.resources?.maxIndexRows ?? 1000000;
  const maxIndexBytes = composition.resources?.maxIndexBytes ?? 268435456;
  const maxLineBytes = composition.resources?.maxLineBytes ?? 1048576;
  if (
    [maxIndexRows, maxIndexBytes, maxLineBytes].some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  )
    throw new Error('Invalid bridge resource bounds');
  let sequence = 0;
  const authority = {
    researchRunId: composition.researchRunId,
    configId: composition.configId,
    sourceConfigSha256: config.sha256,
    compositionSha256,
    strategyName: composition.strategyName,
    symbols: composition.symbols,
    windowStart: composition.windowStart,
    windowEnd: composition.windowEnd,
  };
  const validate = (params) => {
    const signal = params.decision?.signal;
    if (
      manifest.hooks?.beforeEntryGate !== hook ||
      manifest.hooks?.afterBarDecision !== inventoryHook ||
      manifest.hooks?.afterEnrichAi !== captureHook ||
      manifest.aiAdapter !== originalAdapter ||
      (executionOptions &&
        (manifest.hooks?.beforePlaceOrder !== beforeOrderHook ||
          manifest.hooks?.afterPlaceOrder !== afterOrderHook))
    )
      throw new Error('Installed hook/adapter binding changed');
    if (
      params.ctx.env !== 'BACKTEST' ||
      params.ctx.strategyName !== manifest.name ||
      objectSha256(params.ctx.strategyConfig) !== config.sha256 ||
      !signal ||
      !composition.symbols.includes(signal.symbol) ||
      !Number.isSafeInteger(signal.timestamp) ||
      signal.timestamp < composition.windowStart ||
      signal.timestamp > composition.windowEnd ||
      signal.interval !== config.interval ||
      !['LONG', 'SHORT'].includes(signal.direction) ||
      typeof signal.signalId !== 'string' ||
      !signal.signalId ||
      signal.signalId.includes('\0') ||
      signal.symbol.includes('\0') ||
      signal.strategy !== manifest.name
    )
      throw new Error('Hook config/context/decision binding mismatch');
    if (params.entry && params.entry.signal !== signal)
      throw new Error('Hook signal reference mismatch');
    return signal;
  };
  const key = (signal) => `${signal.symbol}\0${signal.signalId}`;
  const originalAdapter = manifest.aiAdapter;
  const pendingExecutions = new Map();
  let pendingExecutionBytes = 0;
  let peakPendingExecutionBytes = 0;
  let executionFailed = false;
  let sequenceOfGateLinks = 0;
  let observationSequence = 0;
  const failExecution = () => {
    executionFailed = true;
    executionSink?.abort();
    onExecutionFailure?.();
  };
  const executionAppend = (row) => {
    if (!Number.isSafeInteger(observationSequence))
      throw new Error('Execution observation sequence exhausted');
    row = { ...row, observationSequence: observationSequence++ };
    if (Buffer.byteLength(JSON.stringify(row)) > maxLineBytes)
      throw new Error('Execution row line bound exceeded');
    executionSink.append(immutableClone(row));
  };
  const linkInvocation = (record, outcome) => {
    if (!executionOptions) return;
    try {
      const id = key(record);
      if (Buffer.byteLength(id) > executionOptions.maxIdentityBytes)
        throw new Error('Execution identity byte bound');
      const link = {
        ...authority,
        symbol: record.symbol,
        signalId: record.signalId,
        direction: record.direction,
        timestamp: record.timestamp,
        disposition: record.disposition,
        captureSequence: record.captureSequence,
        payloadSha256: record.payloadSha256,
        featureSha256: record.featureSha256,
        workerObservationSha256: observation.sha256,
        gateObservationSha256: outcome.gateObservationSha256,
      };
      const invocationId = objectSha256(link);
      const compact = { ...link, invocationId };
      executionAppend({
        schema: 'tradejs-entry-execution-observation/v1',
        stage: 'gate-invocation-link',
        ...compact,
        ...outcome,
      });
      sequenceOfGateLinks++;
      if (outcome.allow) {
        const bytes =
          Buffer.byteLength(JSON.stringify(compact)) + Buffer.byteLength(id);
        if (
          pendingExecutions.has(id) ||
          pendingExecutions.size >= executionOptions.maxPendingInvocations ||
          pendingExecutionBytes + bytes > executionOptions.maxPendingBytes
        )
          throw new Error('Execution pending bound/duplicate');
        pendingExecutions.set(id, { link: compact, bytes, attempted: false });
        pendingExecutionBytes += bytes;
        peakPendingExecutionBytes = Math.max(
          peakPendingExecutionBytes,
          pendingExecutionBytes,
        );
      }
    } catch (error) {
      failExecution();
      throw error;
    }
  };
  const executionHook = (stage, prior) => async (params) => {
    try {
      await prior?.(params);
      const signal = validate(params);
      const pending = pendingExecutions.get(key(signal));
      const executionTimestamp = params.market?.candle?.timestamp;
      if (
        !pending ||
        !Number.isSafeInteger(executionTimestamp) ||
        executionTimestamp < pending.link.timestamp ||
        params.policy.minAiQuality !== config.minAiQuality
      )
        throw new Error('Execution invocation/argument binding mismatch');
      if (stage === 'before-place-order-attempt') {
        if (pending.attempted) throw new Error('Duplicate order attempt');
        pending.attempted = true;
        executionAppend({
          schema: 'tradejs-entry-execution-observation/v1',
          stage,
          ...pending.link,
          executionTimestamp,
        });
      } else {
        if (!pending.attempted) throw new Error('Execution without attempt');
        const result = params.order?.result;
        let observedResult;
        if (typeof result === 'string')
          observedResult = { kind: 'string', value: result };
        else if (
          result &&
          typeof result === 'object' &&
          result.signalId === signal.signalId &&
          result.symbol === signal.symbol &&
          result.timestamp === signal.timestamp
        ) {
          observedResult = {
            kind: 'signal',
            signalId: result.signalId,
            symbol: result.symbol,
            timestamp: result.timestamp,
          };
          for (const field of ['orderStatus', 'orderSkipReason'])
            if (result[field] !== undefined) {
              if (typeof result[field] !== 'string')
                throw new Error('Unsupported public result field');
              observedResult[field] = result[field];
            }
        } else throw new Error('Unsupported public Signal|string result');
        if (
          Buffer.byteLength(JSON.stringify(observedResult)) >
          executionOptions.maxResultBytes
        )
          throw new Error('Execution result byte bound');
        executionAppend({
          schema: 'tradejs-entry-execution-observation/v1',
          stage,
          ...pending.link,
          executionTimestamp,
          observedResult,
          fillGeometryAuthority: false,
        });
        pendingExecutions.delete(key(signal));
        pendingExecutionBytes -= pending.bytes;
      }
    } catch (error) {
      failExecution();
      throw error;
    }
  };
  const beforeOrderHook = executionOptions
    ? executionHook('before-place-order-attempt', priorHooks.beforePlaceOrder)
    : priorHooks.beforePlaceOrder;
  const afterOrderHook = executionOptions
    ? executionHook('after-place-order-executed', priorHooks.afterPlaceOrder)
    : priorHooks.afterPlaceOrder;
  const inventoryHook = async (params) => {
    await priorHooks.afterBarDecision?.(params);
    if (params.decision.kind !== 'entry') return;
    // beta268 is serial per strategy: a later decision proves the earlier decision
    // did not reach this manifest gate. It does not prove a Project veto reason.
    // Opt-in only; legacy snapshot lifecycle/bytes remain unchanged.
    if (executionOptions) snapshots.clear();
    const signal = validate(params);
    const id = key(signal);
    if (inventory.has(id)) throw new Error('Duplicate entry inventory');
    const charge = 512 + Buffer.byteLength(id) * 2;
    if (
      inventory.size >= maxIndexRows ||
      retainedIndexBytes + charge > maxIndexBytes
    )
      throw new Error('Bridge identity resource bound exceeded');
    retainedIndexBytes += charge;
    inventory.add(id);
    sink.append({
      schema: 'tradejs-entry-inventory/v1',
      ...authority,
      symbol: signal.symbol,
      signalId: signal.signalId,
      timestamp: signal.timestamp,
      disposition: captureDisposition(signal.timestamp, authority),
    });
  };
  const captureHook = async (params) => {
    await priorHooks.afterEnrichAi?.(params);
    const signal = validate(params);
    const id = key(signal);
    if (!inventory.has(id) || captured.has(id))
      throw new Error('Missing/duplicate inventory capture');
    const snapshot = immutableClone(signal);
    if (snapshot.additionalIndicators?.backtestExecution != null)
      throw new Error('Future fill before capture');
    const payload = immutableClone(publicAi.buildAiPayload(snapshot));
    const nativeSignal = immutableClone(signalFromCapturedPayload(payload));
    const nativePayload = immutableClone(publicAi.buildAiPayload(nativeSignal));
    const features = immutableClone(collectFeatures(nativePayload));
    if (objectSha256(collectFeatures(payload)) !== objectSha256(features))
      throw new Error('Captured/native selected-feature parity mismatch');
    const record = immutableClone({
      schema: 'tradejs-research-decision-capture/v1',
      stage: 'afterEnrichAi/prequeue',
      ...authority,
      symbol: signal.symbol,
      direction: signal.direction,
      signalId: signal.signalId,
      timestamp: signal.timestamp,
      disposition: captureDisposition(signal.timestamp, authority),
      signalSnapshot: snapshot,
      payload,
      signalSha256: objectSha256(snapshot),
      payloadSha256: objectSha256(payload),
      featureSha256: objectSha256(features),
      captureSequence: sequence++,
      workerObservationSha256: observation.sha256,
    });
    if (Buffer.byteLength(JSON.stringify(record)) > maxLineBytes)
      throw new Error('Bridge capture line byte bound exceeded');
    // Heavy records live only until their public beforeEntryGate callback.
    if (snapshots.size)
      throw new Error(
        'Overlapping pending capture requires reviewed byte bound',
      );
    captured.add(id);
    snapshots.set(id, record);
    sink.append(record);
  };
  const hook = async (params) => {
    const signal = validate(params);
    const record = snapshots.get(key(signal));
    if (
      !record ||
      objectSha256(publicAi.buildAiPayload(immutableClone(signal))) !==
        record.payloadSha256 ||
      params.policy.minAiQuality !== config.minAiQuality
    )
      throw new Error('Gate payload/effective threshold parity mismatch');
    const previous = await priorHooks.beforeEntryGate?.(params);
    if (previous?.allow === false) {
      linkInvocation(record, {
        ownGateCalled: false,
        allow: false,
        priorManifestVeto: true,
        gateObservationSha256: null,
        gateObservationStatus: 'absent-prior-manifest-veto',
      });
      snapshots.delete(key(signal));
      return previous;
    }
    const nativeSignal = immutableClone(
      signalFromCapturedPayload(record.payload),
    );
    const nativePayload = immutableClone(publicAi.buildAiPayload(nativeSignal));
    if (objectSha256(collectFeatures(nativePayload)) !== record.featureSha256)
      throw new Error('Native gate feature parity mismatch');
    const analysis =
      composition.mode === 'capture-pass-all' ||
      composition.mode === 'reject-all'
        ? {}
        : immutableClone(
            await publicAi.runAiPromptLocal(nativeSignal, {
              payload: nativePayload,
            }),
          );
    const quality = number(analysis.quality)
      ? Math.round(analysis.quality)
      : null;
    const directionAllowed =
      config.directionPolicy !== 'long_only' || signal.direction === 'LONG';
    const shortAllowed =
      config.directionPolicy !== 'short_only' || signal.direction === 'SHORT';
    const approved =
      quality != null &&
      analysis.direction === signal.direction &&
      quality >= config.minAiQuality &&
      directionAllowed &&
      shortAllowed;
    const allow =
      composition.mode === 'capture-pass-all'
        ? true
        : composition.mode === 'reject-all'
          ? false
          : approved;
    const gateObservation = {
      schema: 'tradejs-entry-gate-observation/v1',
      ...authority,
      signalId: signal.signalId,
      symbol: signal.symbol,
      timestamp: signal.timestamp,
      disposition: captureDisposition(signal.timestamp, authority),
      payloadSha256: record.payloadSha256,
      featureSha256: record.featureSha256,
      analysis,
      normalizedQuality: quality,
      effectiveMinAiQuality: config.minAiQuality,
      allow,
    };
    const gateObservationSha256 = executionOptions
      ? objectSha256(gateObservation)
      : undefined;
    sink.append(gateObservation);
    linkInvocation(record, {
      ownGateCalled: true,
      allow,
      priorManifestVeto: false,
      gateObservationSha256,
      gateObservationStatus: 'own-gate-observed',
    });
    snapshots.delete(key(signal));
    return {
      allow,
      reason: allow ? undefined : `RESEARCH_FROZEN_GATE:${composition.mode}`,
    };
  };
  manifest.hooks = {
    ...priorHooks,
    afterBarDecision: inventoryHook,
    afterEnrichAi: captureHook,
    beforeEntryGate: hook,
    ...(executionOptions
      ? { beforePlaceOrder: beforeOrderHook, afterPlaceOrder: afterOrderHook }
      : {}),
  };
  const controller = {
    compositionSha256,
    hook,
    inventoryHook,
    captureHook,
    adapter: originalAdapter,
    ...(executionOptions ? { beforeOrderHook, afterOrderHook } : {}),
    authority,
    counts: () => ({
      inventory: inventory.size,
      captures: captured.size,
      pending: snapshots.size,
      accountedIndexBytes: retainedIndexBytes,
      ...(executionOptions
        ? {
            executionPending: pendingExecutions.size,
            executionPendingLogicalBytes: pendingExecutionBytes,
            peakPendingExecutionLogicalBytes: peakPendingExecutionBytes,
            executionFailed,
          }
        : {}),
    }),
    close: () => {
      if (!executionOptions) return sink.close();
      if (executionFailed) {
        sink.abort?.();
        throw new Error('Execution observation failure: no COMPLETE authority');
      }
      try {
        executionAppend({
          schema: 'tradejs-entry-execution-observation/v1',
          stage: 'closure-unresolved',
          ...authority,
          workerObservationSha256: observation.sha256,
          unresolved: Array.from(pendingExecutions.values(), (item) => ({
            ...item.link,
            attempted: item.attempted,
          })),
          capturedWithoutManifestGate: captured.size - sequenceOfGateLinks,
          resources: {
            pendingLogicalBytes: pendingExecutionBytes,
            peakPendingLogicalBytes: peakPendingExecutionBytes,
            accounting: 'bounded compact JSON bytes; not exact V8 RSS',
          },
          completionAuthority:
            'stages only, not fills; unresolved classification requires native trace/reconciliation',
        });
        executionSink.close();
        return sink.close();
      } catch (error) {
        failExecution();
        sink.abort?.();
        throw error;
      }
    },
  };
  controllers.set(manifest, controller);
  return controller;
};

const verifiedFile = (projectRoot, descriptor) => {
  if (!descriptor?.path || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? ''))
    throw new Error('SHA-bound artifact required');
  const file = boundPath(projectRoot, descriptor.path);
  if (sha256(fs.readFileSync(file)) !== descriptor.sha256)
    throw new Error('Authority artifact checksum mismatch');
  return file;
};
const publicModule = (require, packageName, subpath, projectRoot) => {
  const cjs = boundPath(
    projectRoot,
    require.resolve(`${packageName}/${subpath}`),
  );
  const packageRoot = boundPath(projectRoot, `node_modules/${packageName}`);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'package.json')),
  );
  const exportEntry = pkg.exports?.[`./${subpath}`];
  const target = exportEntry?.import ?? exportEntry?.node?.import;
  const importPath = typeof target === 'string' ? target : target?.default;
  if (!importPath?.startsWith('./'))
    throw new Error('Explicit public ESM export required');
  return {
    cjs,
    esm: boundPath(projectRoot, path.join(packageRoot, importPath)),
  };
};
export const activateResearchEntryGate = async (activation) => {
  if (!activation) return null;
  const { composition, projectRoot, compositionSha256, workerPath } =
    activation;
  validateBridgeComposition(composition);
  const checkpointPath = verifiedFile(
    projectRoot,
    composition.runtimeCheckpoint,
  );
  const authorityPath = verifiedFile(
    projectRoot,
    composition.strategyArtifactAuthority,
  );
  const bootstrapPath = verifiedFile(projectRoot, composition.bootstrap);
  if (pathToFileURL(bootstrapPath).href !== import.meta.url)
    throw new Error('Bootstrap self authority mismatch');
  for (const name of [
    'decision-capture-join.mjs',
    'ai-gate-ablation.mjs',
    ...(composition.storage ? ['decision-capture-storage.mjs'] : []),
  ]) {
    const dependencyPath = verifiedFile(
      projectRoot,
      composition.toolingDependencies?.[name],
    );
    if (dependencyPath !== fileURLToPath(new URL(name, import.meta.url)))
      throw new Error('Tooling dependency authority mismatch');
  }
  let shardedStorage;
  if (composition.storage) {
    shardedStorage = await import('./decision-capture-storage.mjs');
    shardedStorage.storageLimits(composition.storage);
    if (
      composition.toolingDependencies['decision-capture-storage.mjs'].sha256 !==
      composition.storage.helperSha256
    )
      throw new Error('Storage helper composition mismatch');
  }
  if (composition.executionObservations) {
    verifyExecutionObservationModules(projectRoot, composition);
  }
  // Existing full checkpoint/build verifier is reused without edits, builds or imports of strategy source.
  const {
    ensureRuntimeBuild,
    verifyStrategyArtifactAuthority,
    loadStandaloneStrategyEntries,
  } = await import('./ai-gate-ablation.mjs');
  const runtime = await ensureRuntimeBuild(null, {
    projectRoot,
    runtimeCheckpoint: checkpointPath,
  });
  if (runtime.executionRuntime.generation !== '3.1.29-beta.268')
    throw new Error('Pinned beta268 required');
  const options = {
    projectRoot,
    strategyArtifactAuthority: authorityPath,
    executionRuntime: runtime.executionRuntime,
  };
  const artifact = verifyStrategyArtifactAuthority({
    ...options,
    sourceRepositoryRoot: composition.sourceRepositoryRoot,
  });
  const require = createRequire(path.join(projectRoot, 'package.json'));
  const registryPaths = publicModule(
    require,
    '@tradejs/node',
    'registry',
    projectRoot,
  );
  const aiPaths = publicModule(
    require,
    '@tradejs/node',
    'strategies',
    projectRoot,
  );
  const cjsRegistry = require(registryPaths.cjs);
  const registry = await import(pathToFileURL(registryPaths.esm).href);
  const publicAi = await import(pathToFileURL(aiPaths.esm).href);
  await registry.ensureStrategyPluginsLoaded(projectRoot);
  await cjsRegistry.ensureStrategyPluginsLoaded(projectRoot);
  const manifest = registry.getStrategyManifest(
    composition.strategyName,
    projectRoot,
  );
  if (
    !manifest ||
    cjsRegistry.getStrategyManifest(composition.strategyName, projectRoot) !==
      manifest
  )
    throw new Error('CJS/ESM registry singleton parity failed');
  if (controllers.has(manifest))
    return installEntryGateBridge({ manifest, composition, compositionSha256 });
  // Checkpoint includes installed target; additionally require its dist to equal exact historical core artifact.
  const target =
    runtime.executionRuntime.packages[artifact.strategyArtifact.packageName];
  if (!target || target.distSha256 !== artifact.strategyArtifact.distSha256)
    throw new Error('Installed core/artifact mismatch');
  if (manifest.policyProfiles?.length)
    throw new Error('Profile adapter requires explicit reviewed binding');
  if (composition.mode === 'replacement') {
    const ownPath = verifiedFile(projectRoot, composition.ownAdapterAuthority);
    const own = await loadStandaloneStrategyEntries(
      composition.sourceRepositoryRoot,
      { ...options, strategyArtifactAuthority: ownPath },
    );
    const ownEntry = own.strategyEntries.find(
      (entry) => entry.manifest.name === composition.strategyName,
    );
    if (
      !ownEntry?.manifest.aiAdapter ||
      ownEntry.manifest.policyProfiles?.length
    )
      throw new Error('Own adapter binding missing');
    manifest.aiAdapter = ownEntry.manifest.aiAdapter;
  }
  const pocket = require(runtime.pocketModulePath);
  let processReceiptAuthority;
  if (composition.executionObservations) {
    const processPath = boundPath(
      projectRoot,
      path.join(
        composition.outputDirectory,
        'worker-' + process.pid + '.process.json',
      ),
      false,
    );
    writeExclusiveJson(processPath, {
      schema: 'tradejs-research-worker-process-receipt/v1',
      researchRunId: composition.researchRunId,
      sourceConfigSha256: composition.config.sha256,
      compositionSha256,
      ...secretFreeProcessReceipt(),
    });
    processReceiptAuthority = {
      path: processPath,
      sha256: sha256(fs.readFileSync(processPath)),
    };
  }
  const observation = {
    schema: 'tradejs-research-worker-observation/v1',
    pid: process.pid,
    ppid: process.ppid,
    ...(composition.executionObservations
      ? { processReceipt: processReceiptAuthority }
      : { argv: process.argv }),
    researchRunId: composition.researchRunId,
    sourceConfigSha256: composition.config.sha256,
    compositionSha256,
    workerPath,
    workerSha256: sha256(fs.readFileSync(workerPath)),
    executionRuntime: runtime.executionRuntime,
    strategyArtifact: artifact.strategyArtifact,
    registrySingleton: true,
    registryPaths,
    aiPaths,
    bootstrap: composition.bootstrap,
    toolingDependencies: composition.toolingDependencies,
    ownAdapterAuthority: composition.ownAdapterAuthority ?? null,
    ...(composition.executionObservations
      ? {
          executionObservations: composition.executionObservations,
          executionObservationModules: verifyExecutionObservationModules(
            projectRoot,
            composition,
          ),
        }
      : {}),
  };
  const observationPath = boundPath(
    projectRoot,
    path.join(
      composition.outputDirectory,
      `worker-${process.pid}.observation.json`,
    ),
    false,
  );
  writeExclusiveJson(observationPath, observation);
  const observationBinding = {
    path: observationPath,
    sha256: sha256(fs.readFileSync(observationPath)),
  };
  const authority = {
    researchRunId: composition.researchRunId,
    configId: composition.configId,
    sourceConfigSha256: composition.config.sha256,
    compositionSha256,
    strategyName: composition.strategyName,
    symbols: composition.symbols,
    windowStart: composition.windowStart,
    windowEnd: composition.windowEnd,
  };
  const sinkFactory = composition.storage
    ? shardedStorage.createShardedCaptureSink
    : createCaptureSink;
  const sink = sinkFactory({
    projectRoot,
    outputPath: path.join(
      composition.outputDirectory,
      `worker-${process.pid}.capture.jsonl`,
    ),
    authority,
    workerObservation: observationBinding,
    maxLineBytes: composition.resources?.maxLineBytes,
    ...(composition.storage ? { storage: composition.storage } : {}),
  });
  const executionSink = composition.executionObservations
    ? shardedStorage.createShardedCaptureSink({
        projectRoot,
        outputPath: path.join(
          composition.outputDirectory,
          'worker-' + process.pid + '.execution.jsonl',
        ),
        authority,
        workerObservation: observationBinding,
        maxLineBytes: composition.resources?.maxLineBytes,
        storage: composition.storage,
      })
    : undefined;
  const onExecutionFailure = () => {
    const failurePath = boundPath(
      projectRoot,
      path.join(
        composition.outputDirectory,
        'worker-' + process.pid + '.execution-failed.json',
      ),
      false,
    );
    if (!fs.existsSync(failurePath))
      writeExclusiveJson(failurePath, {
        schema: 'tradejs-entry-execution-observation-failure/v1',
        status: 'failed-no-complete-authority',
        ...authority,
        pid: process.pid,
      });
  };
  const controller = installEntryGateBridge({
    manifest,
    composition,
    compositionSha256,
    publicAi,
    collectFeatures: (payload) =>
      pocket.collectAiPocketFeatureSnapshot({
        payload,
        featurePolicy: 'causal-stationary',
      }).features,
    sink,
    observation: observationBinding,
    executionSink,
    onExecutionFailure,
  });
  // testerWorker calls process.exit(0), which does not emit beforeExit.
  // The sink deliberately uses synchronous fsync/readback/exclusive receipt I/O.
  process.once('exit', () => controller.close());
  return controller;
};

// Designed for NODE_OPTIONS --import; strict inactive boundary precedes all runtime imports.
if (process.env.TRADEJS_RESEARCH_ENTRY_GATE_COMPOSITION)
  await activateResearchEntryGate(checkActivation());
