import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  createShardedCaptureSink,
  readStorageManifest,
} from './decision-capture-storage.mjs';
import { installEntryGateBridge } from './research-entry-gate-bridge.mjs';
import {
  createCaptureSink,
  immutableClone,
  objectSha256,
  sha256,
  joinDecisionCaptures,
  readJsonLines,
  scanJsonLines,
  readIndexedCapture,
} from './decision-capture-join.mjs';

test('bounded sequential gzip scan preserves exact decoded JSONL records', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-gzip-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const bytes = Buffer.from('{"a":1}\n{"a":2}\n');
  const plain = path.join(dir, 'rows.jsonl');
  const gzip = plain + '.gz';
  fs.writeFileSync(plain, bytes);
  fs.writeFileSync(gzip, gzipSync(bytes));
  const collect = async (file, options) => {
    const rows = [];
    for await (const row of scanJsonLines(file, options)) rows.push(row);
    return rows;
  };
  assert.deepEqual(await collect(gzip), await collect(plain));
  await assert.rejects(
    collect(gzip, { maxDecodedBytes: bytes.length - 1 }),
    /Decoded JSONL byte bound/,
  );
  assert.throws(
    () => readIndexedCapture(gzip, { offset: 0, length: 8 }),
    /Compressed indexed capture/,
  );
});

test('sequential gzip scan rejects truncated and noncanonical input', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-gzip-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const collect = async (file) => {
    for await (const _row of scanJsonLines(file)) {
      /* exhaust */
    }
  };
  const broken = path.join(dir, 'broken.jsonl.gz');
  const bytes = gzipSync(Buffer.from('{"a":1}\n'));
  fs.writeFileSync(broken, bytes.subarray(0, bytes.length - 4));
  await assert.rejects(collect(broken));
  const invalid = path.join(dir, 'invalid.jsonl.gz');
  fs.writeFileSync(invalid, gzipSync(Buffer.from('{"z":1,"a":2}\n')));
  await assert.rejects(collect(invalid), /Noncanonical/);
});

const fixture = (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-join-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true }));
  const resolved = { INTERVAL: '15', MIN_AI_QUALITY: 4 };
  const authority = {
    researchRunId: 'external-research-run',
    configId: 'config-one',
    strategyName: 'LiquidityZones',
    sourceConfigSha256: objectSha256(resolved),
    compositionSha256: 'b'.repeat(64),
    symbols: ['BTCUSDT'],
    windowStart: 0,
    windowEnd: 100,
  };
  const originalTest = {
    symbol: 'BTCUSDT',
    strategyName: 'LiquidityZones',
    configId: 'config-one',
    strategyConfig: resolved,
    testId: 'real-id',
    testSuiteId: 'real-suite',
  };
  const manifest = {
    runId: 'real-backtest-run',
    status: 'completed',
    window: { start: 0, end: 100 },
    testSuite: [originalTest],
  };
  const checkpoint = [
    {
      status: 'success',
      testKey: 'key',
      result: {
        test: {
          ...originalTest,
          backtestRunId: manifest.runId,
          backtestTestKey: 'key',
          chunkId: 'chunk',
        },
      },
    },
  ];
  const signal = {
    signalId: 'one',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    timestamp: 10,
    strategy: 'LiquidityZones',
    interval: '15',
    prices: { currentPrice: 100, stopLossPrice: 99, takeProfitPrice: 102 },
  };
  const payload = {
    signal,
    figures: {},
    indicators: {},
    additionalIndicators: { causal: 1 },
  };
  const capture = {
    schema: 'tradejs-research-decision-capture/v1',
    stage: 'afterEnrichAi/prequeue',
    ...authority,
    ...signal,
    signalSnapshot: signal,
    payload,
    signalSha256: objectSha256(signal),
    payloadSha256: objectSha256(payload),
  };
  const row = {
    signalId: 'one',
    symbol: signal.symbol,
    direction: signal.direction,
    timestamp: signal.timestamp,
    strategyName: authority.strategyName,
    profit: 2,
    tradeResult: { exitTimestamp: 30, entryPrice: 777 },
    payload: {
      signal: { ...signal, prices: { currentPrice: 777 } },
      additionalIndicators: { future: 999 },
    },
    backtestRunId: manifest.runId,
    configId: authority.configId,
    backtestTestKey: 'key',
    backtestChunkId: 'chunk',
    testId: 'real-id',
    testSuiteId: 'real-suite',
  };
  const jsonFile = (name, value) => {
    const bytes = JSON.stringify(value);
    fs.writeFileSync(path.join(projectRoot, name), bytes, { flag: 'wx' });
    return { path: name, sha256: sha256(bytes) };
  };
  const workerObservation = jsonFile('worker-observation.json', {
    schema: 'tradejs-research-worker-observation/v1',
    researchRunId: authority.researchRunId,
    sourceConfigSha256: authority.sourceConfigSha256,
    compositionSha256: authority.compositionSha256,
    registrySingleton: true,
  });
  capture.workerObservationSha256 = workerObservation.sha256;
  const write = (captures = [capture], rows = [row]) => {
    const sink = createCaptureSink({
      projectRoot,
      outputPath: 'captures.jsonl',
      authority,
      workerObservation,
    });
    captures.forEach((record) => {
      sink.append({
        schema: 'tradejs-entry-inventory/v1',
        ...authority,
        signalId: record.signalId,
        symbol: record.symbol,
        timestamp: record.timestamp,
      });
      sink.append(record);
    });
    sink.close();
    fs.writeFileSync(
      path.join(projectRoot, 'completed.jsonl'),
      rows.map((record) => JSON.stringify(record)).join('\n') + '\n',
    );
    const runBinding = jsonFile('mapping.json', {
      schema: 'tradejs-research-backtest-run-binding/v1',
      researchRunId: authority.researchRunId,
      compositionSha256: authority.compositionSha256,
      backtestRunId: manifest.runId,
      manifest: jsonFile('manifest.json', manifest),
      completedCheckpoint: jsonFile('checkpoint.json', checkpoint),
    });
    return {
      projectRoot,
      captureFiles: ['captures.jsonl'],
      acceptedCaptureReceipts: ['captures.jsonl.receipt.json'],
      completedFiles: ['completed.jsonl'],
      outputPath: 'joined.jsonl',
      authority,
      runBinding,
    };
  };
  return {
    projectRoot,
    authority,
    signal,
    payload,
    capture,
    row,
    manifest,
    checkpoint,
    write,
    jsonFile,
  };
};

const shardedRequest = async (f, request, discoveryBounds) => {
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
  const originalReceipt = JSON.parse(
    fs.readFileSync(
      path.join(f.projectRoot, request.acceptedCaptureReceipts[0]),
    ),
  );
  const sink = createShardedCaptureSink({
    projectRoot: f.projectRoot,
    outputPath: 'shards',
    authority: f.authority,
    workerObservation: originalReceipt.workerObservation,
    storage,
  });
  for await (const row of readJsonLines(
    path.join(f.projectRoot, request.captureFiles[0]),
  ))
    sink.append(row);
  sink.close();
  const file = path.join(f.projectRoot, 'shards.storage.json');
  return {
    ...request,
    storage,
    storageManifests: [
      { path: 'shards.storage.json', sha256: sha256(fs.readFileSync(file)) },
    ],
    discoveryBounds,
  };
};

const cloneEvent = (f, id, timestamp, exit = timestamp + 1) => {
  const capture = JSON.parse(JSON.stringify(f.capture));
  capture.signalId = id;
  capture.timestamp = timestamp;
  capture.signalSnapshot.signalId = id;
  capture.signalSnapshot.timestamp = timestamp;
  capture.payload.signal.signalId = id;
  capture.payload.signal.timestamp = timestamp;
  capture.signalSha256 = objectSha256(capture.signalSnapshot);
  capture.payloadSha256 = objectSha256(capture.payload);
  const row = {
    ...f.row,
    signalId: id,
    timestamp,
    tradeResult: { ...f.row.tradeResult, exitTimestamp: exit },
  };
  return { capture, row };
};

test('sharded join preserves native order, replaces future payload and gzip-decodes each capture once', async (t) => {
  const f = fixture(t);
  const second = cloneEvent(f, 'two', 20, 30);
  const original = f.write([f.capture, second.capture], [second.row, f.row]);
  const request = await shardedRequest(f, original);
  const receipt = await joinDecisionCaptures(request);
  assert.equal(receipt.completed, 2);
  assert.equal(receipt.resources.maximumDecodesPerCaptureArchive, 1);
  assert.equal(receipt.resources.noWholeDatasetPayloadIndex, true);
  assert.equal(
    receipt.resources.native.indexValuePolicy,
    'caller-provided bounded JSON; payload-free not guaranteed',
  );
  assert.equal(
    receipt.resources.indexValuePolicy,
    'compact identities/offsets only in this join',
  );
  assert.ok(receipt.resources.output.peakBufferedPayloadRows > 0);
  assert.equal(receipt.resources.output.nativeSequencePreserved, true);
  const rows = [];
  for await (const line of readStorageManifest({
    projectRoot: f.projectRoot,
    descriptor: receipt.output,
    authority: f.authority,
    expectedStorage: request.storage,
  }))
    rows.push(line.row);
  assert.deepEqual(
    rows.map((r) => r.signalId),
    ['two', 'one'],
  );
  assert.equal(rows[0].payload.additionalIndicators.future, undefined);
  assert.deepEqual(rows[1].tradeResult, f.row.tradeResult);
});

test('sharded maturity seal ignores crossing/unknown/test profits and feature contamination before payload validation', async (t) => {
  const run = async (contaminate) => {
    const f = fixture(t);
    const crossing = cloneEvent(f, 'crossing', 20, 60);
    const unknown = cloneEvent(f, 'unknown', 30, undefined);
    const sealed = cloneEvent(f, 'test', 60, 70);
    unknown.row.tradeResult = {};
    if (contaminate)
      for (const event of [crossing, unknown, sealed]) {
        event.row.profit = null;
        event.capture.payload = { future: { illegal: 'never validate' } };
        event.capture.payloadSha256 = '0'.repeat(64);
      }
    const request = await shardedRequest(
      f,
      f.write(
        [f.capture, crossing.capture, unknown.capture, sealed.capture],
        [f.row, crossing.row, unknown.row, sealed.row],
      ),
      { start: 0, cutoff: 50 },
    );
    const receipt = await joinDecisionCaptures(request);
    const rows = [];
    for await (const line of readStorageManifest({
      projectRoot: f.projectRoot,
      descriptor: receipt.output,
      authority: f.authority,
      expectedStorage: request.storage,
    }))
      rows.push(line.row);
    return { rows, maturity: receipt.maturity };
  };
  const clean = await run(false);
  const changed = await run(true);
  assert.deepEqual(clean, changed);
  assert.deepEqual(clean.maturity, {
    sealedDecisionRows: 1,
    preWindow: 0,
    unknown: 1,
    crossing: 1,
    selected: 1,
  });
});

test('sharded END capture remains diagnostic and never extends strict learning window', async (t) => {
  const f = fixture(t);
  const end = cloneEvent(f, 'end', 100, 100);
  const request = await shardedRequest(
    f,
    f.write([f.capture, end.capture], [f.row, end.row]),
  );
  const receipt = await joinDecisionCaptures(request);
  assert.equal(receipt.boundary.terminalDecisionCaptures, 1);
  assert.equal(receipt.boundary.terminalDecisionCompleted, 1);
  assert.equal(receipt.boundary.strictWindowCompleted, 1);
});

test('sharded original inventory timestamp sidecar contains no payload/features/labels', async (t) => {
  const f = fixture(t);
  const request = await shardedRequest(f, f.write());
  const manifest = JSON.parse(
    fs.readFileSync(path.join(f.projectRoot, request.storageManifests[0].path)),
  );
  assert.equal(manifest.inventorySidecar.rows, 1);
  for await (const { row } of readStorageManifest({
    projectRoot: f.projectRoot,
    descriptor: manifest.inventorySidecar,
    authority: f.authority,
    expectedStorage: request.storage,
  })) {
    assert.deepEqual(Object.keys(row).sort(), [
      'schema',
      'sequence',
      'signalId',
      'symbol',
      'timestamp',
    ]);
    assert.equal(row.timestamp, 10);
  }
});

test('sharded partial actual manifest and wrong worker evidence fail before joined success', async (t) => {
  const f = fixture(t);
  f.manifest.status = 'running';
  const request = await shardedRequest(f, f.write());
  await assert.rejects(
    joinDecisionCaptures(request),
    /Completed manifest binding mismatch/,
  );
  assert.equal(
    fs.existsSync(path.join(f.projectRoot, 'joined.jsonl.join-receipt.json')),
    false,
  );
});
test('native shape join preserves original labels, replaces all future payload and binds hashes', async (t) => {
  const f = fixture(t);
  const request = f.write();
  const receipt = await joinDecisionCaptures(request);
  const rows = [];
  for await (const row of readJsonLines(
    path.join(f.projectRoot, 'joined.jsonl'),
  ))
    rows.push(row);
  assert.equal(rows[0].payload.signal.prices.currentPrice, 100);
  assert.equal(rows[0].payload.additionalIndicators.future, undefined);
  assert.equal(rows[0].tradeResult.entryPrice, 777);
  assert.equal(rows[0].profit, 2);
  assert.equal(rows[0].testId, 'real-id');
  assert.equal(receipt.output.rows, 1);
  assert.equal(receipt.sourceFiles.length, 7);
  assert.equal(receipt.status, 'joined-not-learning-accepted');
  assert.equal(receipt.actualBacktestRunId, 'real-backtest-run');
  await assert.rejects(joinDecisionCaptures(request), /Output must be new/);
});
for (const mutation of [
  'duplicate-capture',
  'duplicate-label',
  'missing-capture',
  'direction',
  'run',
  'exit',
  'payload',
])
  test(`join fails closed ${mutation}`, async (t) => {
    const f = fixture(t);
    const captures = [f.capture];
    const rows = [f.row];
    if (mutation === 'duplicate-capture') captures.push(f.capture);
    if (mutation === 'duplicate-label') rows.push(f.row);
    if (mutation === 'missing-capture')
      rows[0] = { ...f.row, signalId: 'missing' };
    if (mutation === 'direction') rows[0] = { ...f.row, direction: 'SHORT' };
    if (mutation === 'run') rows[0] = { ...f.row, backtestRunId: 'invented' };
    if (mutation === 'exit')
      rows[0] = { ...f.row, tradeResult: { exitTimestamp: 1 } };
    if (mutation === 'payload')
      captures[0] = { ...f.capture, payloadSha256: '0'.repeat(64) };
    await assert.rejects(joinDecisionCaptures(f.write(captures, rows)));
    assert.equal(
      fs.existsSync(path.join(f.projectRoot, 'joined.jsonl.receipt.json')),
      false,
    );
  });
test('unmatched delayed-rejected capture counted, never imputed as zero-profit', async (t) => {
  const f = fixture(t);
  const otherSignal = { ...f.signal, signalId: 'rejected' };
  const otherPayload = { ...f.payload, signal: otherSignal };
  const other = {
    ...f.capture,
    signalId: 'rejected',
    signalSnapshot: otherSignal,
    payload: otherPayload,
    signalSha256: objectSha256(otherSignal),
    payloadSha256: objectSha256(otherPayload),
  };
  const receipt = await joinDecisionCaptures(f.write([f.capture, other]));
  assert.equal(receipt.unmatchedCaptures, 1);
  assert.equal(receipt.output.rows, 1);
});
test('immutable capture payload unaffected by label/profit/future changes', (t) => {
  const f = fixture(t);
  const snapshot = immutableClone(f.payload);
  const hash = objectSha256(snapshot);
  f.row.profit = -999;
  f.row.tradeResult.entryPrice = -999;
  f.payload.signal.prices.currentPrice = 999;
  assert.equal(objectSha256(snapshot), hash);
  assert.equal(snapshot.signal.prices.currentPrice, 100);
});
test('wx capture and receipt ownership cannot overwrite existing files', (t) => {
  const f = fixture(t);
  f.write();
  assert.throws(
    () =>
      createCaptureSink({
        projectRoot: f.projectRoot,
        outputPath: 'captures.jsonl',
        authority: f.authority,
      }),
    /already exists/,
  );
});
for (const mutation of [
  'mapping-run',
  'mapping-external',
  'mapping-sha',
  'missing-manifest',
  'partial-run',
  'manifest-config',
  'manifest-symbol',
  'manifest-window',
  'partial-checkpoint',
  'checkpoint-chunk',
  'checkpoint-session',
  'checkpoint-test-config',
])
  test(`completed binding rejects ${mutation}`, async (t) => {
    const f = fixture(t);
    if (mutation === 'partial-run') f.manifest.status = 'running';
    if (mutation === 'manifest-config')
      f.manifest.testSuite[0].configId = 'foreign-config';
    if (mutation === 'manifest-symbol')
      f.manifest.testSuite[0].symbol = 'FOREIGN';
    if (mutation === 'manifest-window') f.manifest.window.end = 999;
    if (mutation === 'partial-checkpoint') f.checkpoint.splice(0);
    if (mutation === 'checkpoint-chunk')
      delete f.checkpoint[0].result.test.chunkId;
    if (mutation === 'checkpoint-session')
      f.checkpoint[0].result.test.testSuiteId = 'invented';
    if (mutation === 'checkpoint-test-config')
      f.checkpoint[0].result.test.strategyConfig = { bad: true };
    const request = f.write();
    const mapping = JSON.parse(
      fs.readFileSync(path.join(f.projectRoot, 'mapping.json')),
    );
    if (mutation === 'mapping-run') mapping.backtestRunId = 'wrong';
    if (mutation === 'mapping-external') mapping.researchRunId = 'wrong';
    if (mutation === 'mapping-sha') request.runBinding.sha256 = '0'.repeat(64);
    if (mutation === 'missing-manifest') mapping.manifest.path = 'absent.json';
    if (
      ['mapping-run', 'mapping-external', 'missing-manifest'].includes(mutation)
    )
      request.runBinding = f.jsonFile('wrong-mapping.json', mapping);
    await assert.rejects(joinDecisionCaptures(request));
    assert.equal(
      fs.existsSync(path.join(f.projectRoot, 'joined.jsonl.receipt.json')),
      false,
    );
  });
test('mapping required; external capture ID never accepted as actual run ID', async (t) => {
  const f = fixture(t);
  const request = f.write();
  await assert.rejects(
    joinDecisionCaptures({ ...request, runBinding: undefined }),
    /mapping artifact/,
  );
  const row = { ...f.row, backtestRunId: f.authority.researchRunId };
  fs.writeFileSync(
    path.join(f.projectRoot, 'completed.jsonl'),
    JSON.stringify(row) + '\n',
  );
  await assert.rejects(joinDecisionCaptures(request), /binding mismatch/);
});
test('source mutation during streaming leaves partial output without success receipt', async (t) => {
  const f = fixture(t);
  const request = f.write();
  const original = fs.createReadStream;
  let captureOpened = false;
  t.mock.method(fs, 'createReadStream', function (file, ...args) {
    if (String(file).endsWith('captures.jsonl')) {
      if (captureOpened)
        fs.appendFileSync(path.join(f.projectRoot, 'manifest.json'), ' ');
      captureOpened = true;
    }
    return original.call(this, file, ...args);
  });
  await assert.rejects(joinDecisionCaptures(request), /source changed/);
  assert.equal(
    fs.existsSync(path.join(f.projectRoot, 'joined.jsonl.receipt.json')),
    false,
  );
});
test('worker observation checksum tampering blocks before output', async (t) => {
  const f = fixture(t);
  const request = f.write();
  fs.appendFileSync(path.join(f.projectRoot, 'worker-observation.json'), ' ');
  await assert.rejects(joinDecisionCaptures(request), /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(f.projectRoot, 'joined.jsonl')), false);
});
test('Unicode indexed byte offsets read one immutable capture at a time', async (t) => {
  const f = fixture(t);
  f.capture.payload.additionalIndicators.unicode = 'Рынок 🐋';
  f.capture.payloadSha256 = objectSha256(f.capture.payload);
  const request = f.write();
  const file = path.join(f.projectRoot, 'captures.jsonl');
  const lines = [];
  for await (const line of scanJsonLines(file)) lines.push(line);
  const line = lines[1];
  const entry = { ...line, identity: f.signal };
  assert.equal(
    readIndexedCapture(file, entry).payload.additionalIndicators.unicode,
    'Рынок 🐋',
  );
  for (const bad of [
    { offset: line.offset + 1 },
    { length: line.length - 1 },
    { sha256: '0'.repeat(64) },
    { identity: { ...f.signal, direction: 'SHORT' } },
  ])
    assert.throws(
      () => readIndexedCapture(file, { ...entry, ...bad }),
      /offset|checksum|identity/,
    );
  const receipt = await joinDecisionCaptures(request);
  assert.equal(receipt.resources.retainedPayloads, 0);
  assert.equal(receipt.resources.indexRows, 1);
});
for (const [name, bytes] of [
  ['CRLF', Buffer.from('{}\r\n')],
  ['noncanonical', Buffer.from('{"z":1,"a":2}\n')],
  ['blank', Buffer.from('\n')],
  ['unterminated', Buffer.from('{}')],
  ['invalid UTF8', Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10])],
])
  test(`canonical capture byte scanner rejects ${name}`, async (t) => {
    const f = fixture(t);
    const file = path.join(f.projectRoot, 'invalid.jsonl');
    fs.writeFileSync(file, bytes);
    await assert.rejects(async () => {
      for await (const _ of scanJsonLines(file)) {
      }
    });
  });
test('line and index byte/cardinality limits fail closed without receipt', async (t) => {
  const f = fixture(t);
  const request = f.write();
  for (const bounds of [
    { maxLineBytes: 20 },
    { maxIndexBytes: 10 },
    { maxIndexRows: 0 },
    { maxInputFiles: 1 },
  ]) {
    await assert.rejects(
      joinDecisionCaptures({ ...request, ...bounds }),
      /bound|input groups/,
    );
    assert.equal(
      fs.existsSync(path.join(f.projectRoot, 'joined.jsonl.receipt.json')),
      false,
    );
  }
});
test('huge unterminated line fails before giant JSON parsing', async (t) => {
  const f = fixture(t);
  const file = path.join(f.projectRoot, 'huge.jsonl');
  fs.writeFileSync(file, 'x'.repeat(70000));
  await assert.rejects(async () => {
    for await (const _ of scanJsonLines(file, { maxLineBytes: 1024 })) {
    }
  }, /byte bound/);
});
test('END decision joins only as diagnostic; earlier decision exiting END retains original label', async (t) => {
  const f = fixture(t);
  const terminalSignal = { ...f.signal, signalId: 'terminal', timestamp: 100 };
  const terminalPayload = { ...f.payload, signal: terminalSignal };
  const terminal = {
    ...f.capture,
    signalId: 'terminal',
    timestamp: 100,
    disposition: 'terminal-diagnostic-only',
    signalSnapshot: terminalSignal,
    payload: terminalPayload,
    signalSha256: objectSha256(terminalSignal),
    payloadSha256: objectSha256(terminalPayload),
  };
  const terminalRow = {
    ...f.row,
    signalId: 'terminal',
    timestamp: 100,
    tradeResult: { exitTimestamp: 100 },
  };
  f.row.tradeResult.exitTimestamp = 100;
  const receipt = await joinDecisionCaptures(
    f.write([f.capture, terminal], [f.row, terminalRow]),
  );
  const rows = [];
  for await (const row of readJsonLines(
    path.join(f.projectRoot, 'joined.jsonl'),
  ))
    rows.push(row);
  assert.equal(rows[0].tradeResult.exitTimestamp, 100);
  assert.equal(rows[0].decisionCaptureDisposition, 'strict-window');
  assert.equal(rows[1].decisionCaptureDisposition, 'terminal-diagnostic-only');
  assert.equal(
    rows.filter((row) => row.timestamp >= 0 && row.timestamp < 100).length,
    1,
  );
  assert.equal(
    rows.filter(
      (row) => row.timestamp < 100 && row.tradeResult.exitTimestamp < 100,
    ).length,
    0,
  );
  assert.equal(receipt.boundary.terminalDecisionCaptures, 1);
  assert.equal(receipt.boundary.terminalDecisionCompleted, 1);
  assert.equal(receipt.boundary.strictWindowCompleted, 1);
});
test('unmatched END capture diagnostic count never becomes zero-profit label', async (t) => {
  const f = fixture(t);
  const signal = { ...f.signal, signalId: 'terminal', timestamp: 100 };
  const payload = { ...f.payload, signal };
  const terminal = {
    ...f.capture,
    signalId: signal.signalId,
    timestamp: 100,
    signalSnapshot: signal,
    payload,
    signalSha256: objectSha256(signal),
    payloadSha256: objectSha256(payload),
  };
  const receipt = await joinDecisionCaptures(f.write([f.capture, terminal]));
  assert.equal(receipt.boundary.terminalDecisionUnmatched, 1);
  assert.equal(receipt.output.rows, 1);
});
test('index rows bound is applied to global identities including unmatched inventory', async (t) => {
  const f = fixture(t);
  const signal = { ...f.signal, signalId: 'two' };
  const payload = { ...f.payload, signal };
  const other = {
    ...f.capture,
    signalId: 'two',
    signalSnapshot: signal,
    payload,
    signalSha256: objectSha256(signal),
    payloadSha256: objectSha256(payload),
  };
  await assert.rejects(
    joinDecisionCaptures({ ...f.write([f.capture, other]), maxIndexRows: 1 }),
    /index resource/,
  );
});
test('bounded public hook capture flows into wx native join at END with exact decision fields', async (t) => {
  const f = fixture(t);
  const resolved = f.manifest.testSuite[0].strategyConfig;
  const manifest = { name: f.authority.strategyName };
  const signal = {
    ...f.signal,
    timestamp: 100,
    figures: {},
    indicators: {},
    additionalIndicators: { causal: 'Рынок 🐋' },
  };
  const records = [];
  installEntryGateBridge({
    manifest,
    composition: {
      ...f.authority,
      mode: 'current',
      config: {
        resolved,
        sha256: f.authority.sourceConfigSha256,
        interval: '15',
        minAiQuality: 4,
        nativeMinQuality: 4,
        directionPolicy: 'both',
      },
    },
    compositionSha256: f.authority.compositionSha256,
    publicAi: {
      buildAiPayload: (signal) => ({
        signal: {
          ...signal,
          figures: undefined,
          indicators: undefined,
          additionalIndicators: undefined,
        },
        figures: signal.figures,
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      }),
      runAiPromptLocal: async (signal) => ({
        direction: signal.direction,
        quality: 4,
      }),
    },
    collectFeatures: (payload) => ({
      causal: payload.additionalIndicators.causal,
    }),
    sink: { append: (record) => records.push(record), close() {} },
    observation: { sha256: f.capture.workerObservationSha256 },
  });
  const params = {
    ctx: {
      env: 'BACKTEST',
      strategyName: manifest.name,
      strategyConfig: resolved,
    },
    decision: { kind: 'entry', signal },
    entry: { signal },
    policy: { minAiQuality: 4 },
  };
  await manifest.hooks.afterBarDecision(params);
  await manifest.hooks.afterEnrichAi(params);
  assert.equal((await manifest.hooks.beforeEntryGate(params)).allow, true);
  const capture = records[1];
  const row = { ...f.row, timestamp: 100, tradeResult: { exitTimestamp: 100 } };
  signal.additionalIndicators.causal = 'future-fill';
  const receipt = await joinDecisionCaptures(f.write([capture], [row]));
  const joined = [];
  for await (const row of readJsonLines(
    path.join(f.projectRoot, 'joined.jsonl'),
  ))
    joined.push(row);
  assert.equal(joined[0].payload.additionalIndicators.causal, 'Рынок 🐋');
  assert.equal(receipt.boundary.strictWindowCompleted, 0);
  assert.equal(records[2].disposition, 'terminal-diagnostic-only');
});
test('offset scanner crosses chunk boundaries without losing multibyte UTF8', async (t) => {
  const f = fixture(t);
  const file = path.join(f.projectRoot, 'chunks.jsonl');
  const sink = createCaptureSink({
    projectRoot: f.projectRoot,
    outputPath: 'chunks.jsonl',
    authority: f.authority,
  });
  sink.append({ value: 'a'.repeat(65520) + 'Рынок 🐋' });
  sink.append({ value: 'second' });
  sink.close();
  const lines = [];
  for await (const line of scanJsonLines(file)) lines.push(line);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].row.value.endsWith('Рынок 🐋'), true);
  assert.equal(lines[1].offset, lines[0].length);
});
test('capture sink line bound and global identity delimiter reject adversarial records', async (t) => {
  const f = fixture(t);
  const sink = createCaptureSink({
    projectRoot: f.projectRoot,
    outputPath: 'small.jsonl',
    authority: f.authority,
    maxLineBytes: 20,
  });
  assert.throws(() => sink.append({ value: 'x'.repeat(30) }), /byte bound/);
  sink.close();
  f.capture.signalId = 'one\0evil';
  await assert.rejects(
    joinDecisionCaptures(f.write()),
    /global capture identity/,
  );
});
