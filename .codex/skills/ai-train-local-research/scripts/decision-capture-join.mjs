import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const canonicalJson = (value) => {
  const sort = (item) => {
    if (typeof item === 'number' && !Number.isFinite(item))
      throw new Error('Nonfinite JSON number');
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter((key) => item[key] !== undefined)
          .map((key) => [key, sort(item[key])]),
      );
    return item;
  };
  return JSON.stringify(sort(value));
};
export const objectSha256 = (value) => sha256(canonicalJson(value));
export const immutableClone = (value) => {
  const copy = JSON.parse(canonicalJson(value));
  const freeze = (item) => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
};
export const boundPath = (root, value, existing = true) => {
  const base = fs.realpathSync(root);
  const resolved = path.resolve(base, value);
  if (!resolved.startsWith(`${base}${path.sep}`))
    throw new Error('Path outside Project');
  const actual = fs.realpathSync(existing ? resolved : path.dirname(resolved));
  if (actual !== (existing ? resolved : path.dirname(resolved)))
    throw new Error('Symlink path rejected');
  return resolved;
};
export const hashFile = async (file) => {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { path: file, sha256: hash.digest('hex'), bytes };
};
const hashFileSync = (file) => {
  const fd = fs.openSync(file, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
};
export const readJsonLines = async function* (file) {
  const reader = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of reader) if (line.trim()) yield JSON.parse(line);
  } finally {
    reader.close();
  }
};
// Offsets refer to decoded canonical LF/UTF8 bytes. Gzip is sequential-only.
export const scanJsonLines = async function* (
  file,
  {
    maxLineBytes = 1048576,
    maxDecodedBytes = 16 * 1024 ** 3,
    canonical = true,
  } = {},
) {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0)
    throw new Error('Invalid JSON line byte bound');
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0)
    throw new Error('Invalid decoded JSONL byte bound');
  let pending = Buffer.alloc(0);
  let offset = 0;
  let decodedBytes = 0;
  const source = fs.createReadStream(file, { highWaterMark: 65536 });
  const decoder = file.endsWith('.gz') ? createGunzip() : null;
  if (decoder) source.on('error', (error) => decoder.destroy(error));
  const input = decoder ? source.pipe(decoder) : source;
  try {
    for await (const chunk of input) {
      decodedBytes += chunk.length;
      if (decodedBytes > maxDecodedBytes)
        throw new Error('Decoded JSONL byte bound exceeded');
      let start = 0;
      for (let end = 0; end < chunk.length; end++) {
        if (chunk[end] !== 10) continue;
        const length = pending.length + end - start;
        if (length > maxLineBytes)
          throw new Error('JSON line byte bound exceeded');
        const bytes = Buffer.concat([pending, chunk.subarray(start, end)]);
        if (!length || bytes.includes(13))
          throw new Error('Canonical LF JSONL required');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const row = JSON.parse(text);
        if (canonical && canonicalJson(row) !== text)
          throw new Error('Noncanonical capture JSON');
        yield {
          row,
          offset,
          length: length + 1,
          sha256: sha256(Buffer.concat([bytes, Buffer.from('\n')])),
        };
        offset += length + 1;
        pending = Buffer.alloc(0);
        start = end + 1;
      }
      if (pending.length + chunk.length - start > maxLineBytes)
        throw new Error('JSON line byte bound exceeded');
      pending = Buffer.concat([pending, chunk.subarray(start)]);
    }
    if (pending.length) throw new Error('Unterminated JSONL record');
  } finally {
    source.destroy();
    decoder?.destroy();
  }
};
export const readIndexedCapture = (file, entry, maxLineBytes = 1048576) => {
  if (file.endsWith('.gz'))
    throw new Error('Compressed indexed capture is unsupported');
  if (
    !Number.isSafeInteger(entry.offset) ||
    entry.offset < 0 ||
    !Number.isSafeInteger(entry.length) ||
    entry.length <= 1 ||
    entry.length > maxLineBytes + 1
  )
    throw new Error('Invalid capture offset/length');
  const fd = fs.openSync(file, 'r');
  try {
    if (entry.offset) {
      const prior = Buffer.alloc(1);
      if (
        fs.readSync(fd, prior, 0, 1, entry.offset - 1) !== 1 ||
        prior[0] !== 10
      )
        throw new Error('Capture offset not at LF boundary');
    }
    const bytes = Buffer.alloc(entry.length);
    if (
      fs.readSync(fd, bytes, 0, bytes.length, entry.offset) !== bytes.length ||
      bytes.at(-1) !== 10 ||
      bytes.subarray(0, -1).includes(10) ||
      bytes.includes(13) ||
      sha256(bytes) !== entry.sha256
    )
      throw new Error('Capture offset/checksum mismatch');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, -1),
    );
    const row = JSON.parse(text);
    if (canonicalJson(row) !== text)
      throw new Error('Noncanonical capture JSON');
    if (identityFields.some((field) => row[field] !== entry.identity[field]))
      throw new Error('Indexed capture identity mismatch');
    return row;
  } finally {
    fs.closeSync(fd);
  }
};
export const captureDisposition = (timestamp, authority) => {
  if (
    !finiteInteger(timestamp) ||
    timestamp < authority.windowStart ||
    timestamp > authority.windowEnd
  )
    throw new Error('Capture outside exact session window');
  return timestamp === authority.windowEnd
    ? 'terminal-diagnostic-only'
    : 'strict-window';
};
export const writeExclusiveJson = (file, value) => {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, canonicalJson(value) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

// Each process owns one append file. No existing stream is reopened or truncated.
export const createCaptureSink = ({
  projectRoot,
  outputPath,
  authority,
  workerObservation,
  maxLineBytes = 1048576,
}) => {
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0)
    throw new Error('Invalid capture sink line bound');
  const file = boundPath(projectRoot, outputPath, false);
  const receiptPath = `${file}.receipt.json`;
  if (fs.existsSync(receiptPath))
    throw new Error('Capture receipt already exists');
  const fd = fs.openSync(file, 'wx');
  const hash = createHash('sha256');
  let count = 0;
  let closed = false;
  return {
    file,
    append(record) {
      if (closed) throw new Error('Capture sink closed');
      const bytes = canonicalJson(record) + '\n';
      if (Buffer.byteLength(bytes) > maxLineBytes + 1)
        throw new Error('Capture sink line byte bound exceeded');
      fs.writeFileSync(fd, bytes);
      hash.update(bytes);
      count++;
    },
    close() {
      if (closed) throw new Error('Capture sink already closed');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      closed = true;
      const actual = hashFileSync(file);
      const expected = hash.digest('hex');
      if (actual !== expected) throw new Error('Capture readback mismatch');
      const receipt = {
        schema: 'tradejs-decision-capture-file/v1',
        status: 'stream-closed-not-run-accepted',
        authority,
        workerObservation,
        file,
        sha256: actual,
        rows: count,
      };
      writeExclusiveJson(receiptPath, receipt);
      return receipt;
    },
  };
};

const finiteInteger = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value);
const keyFor = (row) => {
  if (
    [row.symbol, row.signalId].some(
      (value) => typeof value !== 'string' || !value || value.includes('\0'),
    )
  )
    throw new Error('Invalid global capture identity');
  return `${row.symbol}\0${row.signalId}`;
};
const identityFields = ['signalId', 'symbol', 'direction', 'timestamp'];
const readBoundDescriptor = (root, descriptor) => {
  if (!descriptor?.path || !/^[a-f0-9]{64}$/.test(descriptor.sha256 ?? ''))
    throw new Error('SHA-bound mapping artifact required');
  const file = boundPath(root, descriptor.path);
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== descriptor.sha256)
    throw new Error('Mapping artifact checksum mismatch');
  return { path: file, value: JSON.parse(bytes) };
};
export const verifyCompletedRunBinding = (
  projectRoot,
  descriptor,
  authority,
) => {
  const mapping = readBoundDescriptor(projectRoot, descriptor);
  const value = mapping.value;
  if (
    value.schema !== 'tradejs-research-backtest-run-binding/v1' ||
    value.researchRunId !== authority.researchRunId ||
    value.compositionSha256 !== authority.compositionSha256 ||
    !value.backtestRunId
  )
    throw new Error('External/actual run mapping mismatch');
  const manifest = readBoundDescriptor(projectRoot, value.manifest);
  const checkpoint = readBoundDescriptor(
    projectRoot,
    value.completedCheckpoint,
  );
  const run = manifest.value;
  if (
    run.runId !== value.backtestRunId ||
    run.status !== 'completed' ||
    run.window?.start !== authority.windowStart ||
    run.window?.end !== authority.windowEnd ||
    !Array.isArray(run.testSuite) ||
    !run.testSuite.length ||
    !Array.isArray(checkpoint.value)
  )
    throw new Error('Completed manifest binding mismatch');
  const checkTest = (test) => {
    if (
      test.configId !== authority.configId ||
      test.strategyName !== authority.strategyName ||
      !authority.symbols.includes(test.symbol) ||
      objectSha256(test.strategyConfig) !== authority.sourceConfigSha256
    )
      throw new Error('Manifest single-config/source/symbol mismatch');
  };
  for (const test of run.testSuite) checkTest(test);
  if (
    new Set(run.testSuite.map((test) => test.symbol)).size !==
      authority.symbols.length ||
    run.testSuite.length !== authority.symbols.length
  )
    throw new Error('Manifest symbol/session uniqueness mismatch');
  const attempts = new Map();
  for (const entry of checkpoint.value) {
    const test = entry.result?.test;
    if (
      !test ||
      entry.status !== 'success' ||
      !entry.testKey ||
      test.backtestRunId !== run.runId ||
      test.backtestTestKey !== entry.testKey ||
      !test.chunkId
    )
      throw new Error('Completed checkpoint attempt missing');
    checkTest(test);
    if (attempts.has(test.symbol))
      throw new Error('Duplicate completed symbol/session');
    const original = run.testSuite.find((item) => item.symbol === test.symbol);
    const {
      backtestRunId: _run,
      backtestTestKey: _key,
      chunkId: _chunk,
      ...baseTest
    } = test;
    if (objectSha256(baseTest) !== objectSha256(original))
      throw new Error('Checkpoint test differs from manifest');
    if (!test.chunkId || !test.testId || !test.testSuiteId)
      throw new Error('Real checkpoint test/session identity required');
    attempts.set(test.symbol, {
      testKey: entry.testKey,
      chunkId: test.chunkId,
      testId: test.testId,
      testSuiteId: test.testSuiteId,
    });
  }
  if (attempts.size !== authority.symbols.length)
    throw new Error('Incomplete completed checkpoint coverage');
  return {
    actualBacktestRunId: run.runId,
    attempts,
    files: [mapping.path, manifest.path, checkpoint.path],
    expectedHashes: [
      descriptor.sha256,
      value.manifest.sha256,
      value.completedCheckpoint.sha256,
    ],
  };
};
export const validateCapture = (capture, authority) => {
  if (
    capture.schema !== 'tradejs-research-decision-capture/v1' ||
    capture.stage !== 'afterEnrichAi/prequeue'
  )
    throw new Error('Wrong capture schema/stage');
  for (const field of [
    'researchRunId',
    'compositionSha256',
    'sourceConfigSha256',
    'strategyName',
  ])
    if (capture[field] !== authority[field])
      throw new Error(`Capture authority mismatch: ${field}`);
  if (
    !capture.signalId ||
    !capture.symbol ||
    !['LONG', 'SHORT'].includes(capture.direction) ||
    !finiteInteger(capture.timestamp)
  )
    throw new Error('Invalid capture identity');
  if (
    objectSha256(capture.payload) !== capture.payloadSha256 ||
    objectSha256(capture.signalSnapshot) !== capture.signalSha256
  )
    throw new Error('Capture checksum mismatch');
  for (const field of identityFields)
    if (
      capture.payload.signal?.[field] !== capture[field] ||
      capture.signalSnapshot?.[field] !== capture[field]
    )
      throw new Error(`Capture signal mismatch: ${field}`);
  if (
    capture.payload.signal.strategy !== authority.strategyName ||
    capture.signalSnapshot.strategy !== authority.strategyName
  )
    throw new Error('Capture strategy mismatch');
  if (capture.payload.additionalIndicators?.backtestExecution != null)
    throw new Error('Future execution payload forbidden');
};

export const joinDecisionCaptures = async ({
  projectRoot,
  captureFiles,
  completedFiles,
  outputPath,
  authority,
  acceptedCaptureReceipts,
  runBinding,
  maxIndexRows = 1000000,
  maxIndexBytes = 268435456,
  maxLineBytes = 1048576,
  maxInputFiles = 4096,
  storageManifests,
  storage,
  discoveryBounds,
}) => {
  if (storageManifests !== undefined)
    return joinShardedDecisionCaptures({
      projectRoot,
      storageManifests,
      completedFiles,
      outputPath,
      authority,
      runBinding,
      storage,
      discoveryBounds,
      maxIndexRows,
      maxIndexBytes,
      maxLineBytes,
      maxInputFiles,
    });
  if (
    !authority?.researchRunId ||
    !authority.configId ||
    !/^[a-f0-9]{64}$/.test(authority.sourceConfigSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(authority.compositionSha256 ?? '') ||
    !Array.isArray(authority.symbols) ||
    !authority.symbols.length
  )
    throw new Error('Exact external run/config binding required');
  if (
    !Array.isArray(acceptedCaptureReceipts) ||
    !Array.isArray(captureFiles) ||
    !Array.isArray(completedFiles) ||
    acceptedCaptureReceipts.length !== captureFiles.length
  )
    throw new Error('Capture file receipts required');
  if (
    !finiteInteger(authority.windowStart) ||
    !finiteInteger(authority.windowEnd) ||
    authority.windowStart >= authority.windowEnd ||
    new Set(authority.symbols).size !== authority.symbols.length ||
    [maxIndexRows, maxIndexBytes, maxLineBytes, maxInputFiles].some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  )
    throw new Error('Exact unique symbol/window/memory bounds required');
  if (captureFiles.length * 3 + completedFiles.length + 3 > maxInputFiles)
    throw new Error(
      'Unique nonempty input groups required; file bound exceeded',
    );
  const binding = verifyCompletedRunBinding(projectRoot, runBinding, authority);
  const capturesInput = captureFiles.map((file) =>
    boundPath(projectRoot, file),
  );
  const completedInput = completedFiles.map((file) =>
    boundPath(projectRoot, file),
  );
  const receiptInput = acceptedCaptureReceipts.map((file) =>
    boundPath(projectRoot, file),
  );
  const receipts = receiptInput.map((file) =>
    JSON.parse(fs.readFileSync(file)),
  );
  const observations = receipts.map((receipt) =>
    readBoundDescriptor(projectRoot, receipt.workerObservation),
  );
  for (const observation of observations)
    if (
      observation.value.schema !== 'tradejs-research-worker-observation/v1' ||
      observation.value.compositionSha256 !== authority.compositionSha256 ||
      observation.value.researchRunId !== authority.researchRunId ||
      observation.value.sourceConfigSha256 !== authority.sourceConfigSha256 ||
      observation.value.registrySingleton !== true
    )
      throw new Error('Worker observed composition mismatch');
  const inputs = [
    ...capturesInput,
    ...completedInput,
    ...receiptInput,
    ...binding.files,
    ...observations.map((item) => item.path),
  ];
  if (
    !captureFiles.length ||
    !completedFiles.length ||
    new Set(inputs).size !== inputs.length ||
    inputs.length > maxInputFiles
  )
    throw new Error('Unique nonempty input groups required');
  const output = boundPath(projectRoot, outputPath, false);
  const receiptPath = `${output}.receipt.json`;
  if (
    inputs.includes(output) ||
    fs.existsSync(output) ||
    fs.existsSync(receiptPath)
  )
    throw new Error('Output must be new');
  const hashInputs = async () => {
    const result = [];
    for (const file of inputs) result.push(await hashFile(file));
    return result;
  };
  const before = await hashInputs();
  for (let index = 0; index < binding.files.length; index++)
    if (
      before.find((item) => item.path === binding.files[index]).sha256 !==
      binding.expectedHashes[index]
    )
      throw new Error('Validated mapping source changed before scan');
  for (let index = 0; index < observations.length; index++)
    if (
      before.find((item) => item.path === observations[index].path).sha256 !==
      receipts[index].workerObservation.sha256
    )
      throw new Error('Validated observation changed before scan');
  for (let index = 0; index < captureFiles.length; index++) {
    const receipt = JSON.parse(fs.readFileSync(receiptInput[index]));
    if (
      receipt.schema !== 'tradejs-decision-capture-file/v1' ||
      receipt.status !== 'stream-closed-not-run-accepted' ||
      receipt.file !== capturesInput[index] ||
      receipt.sha256 !== before[index].sha256 ||
      objectSha256(receipt.authority) !== objectSha256(authority)
    )
      throw new Error('Capture file authority/receipt mismatch');
  }
  const index = new Map();
  let indexBytes = 0;
  let captureCount = 0;
  let terminalCaptures = 0;
  const reserve = (key, identity) => {
    // Deterministic conservative data accounting, not an exact V8 heap/RSS bound.
    const charge =
      512 +
      Buffer.byteLength(key) +
      Buffer.byteLength(canonicalJson({ ...identity, direction: 'SHORT' })) +
      64;
    if (index.size >= maxIndexRows || indexBytes + charge > maxIndexBytes)
      throw new Error('Capture index resource bound exceeded');
    indexBytes += charge;
    const entry = { identity, captured: false, completed: false };
    index.set(key, entry);
    return entry;
  };
  for (const [fileIndex, file] of capturesInput.entries())
    for await (const line of scanJsonLines(file, { maxLineBytes })) {
      const capture = line.row;
      if (capture.schema === 'tradejs-entry-inventory/v1') {
        const key = keyFor(capture);
        if (
          index.has(key) ||
          capture.researchRunId !== authority.researchRunId ||
          capture.compositionSha256 !== authority.compositionSha256 ||
          capture.sourceConfigSha256 !== authority.sourceConfigSha256 ||
          capture.strategyName !== authority.strategyName ||
          !finiteInteger(capture.timestamp) ||
          !capture.signalId ||
          !authority.symbols.includes(capture.symbol)
        )
          throw new Error('Duplicate/foreign entry inventory');
        captureDisposition(capture.timestamp, authority);
        reserve(key, {
          signalId: capture.signalId,
          symbol: capture.symbol,
          timestamp: capture.timestamp,
        });
        continue;
      }
      if (capture.schema === 'tradejs-entry-gate-observation/v1') continue;
      if (capture.schema !== 'tradejs-research-decision-capture/v1')
        throw new Error('Unknown capture record schema');
      validateCapture(capture, authority);
      if (
        capture.workerObservationSha256 !==
        receipts[fileIndex].workerObservation.sha256
      )
        throw new Error('Capture/worker observation mismatch');
      const key = keyFor(capture);
      const entry = index.get(key);
      if (!entry || entry.captured)
        throw new Error('Missing inventory/duplicate capture');
      if (entry.identity.timestamp !== capture.timestamp)
        throw new Error('Inventory/capture identity/window mismatch');
      const disposition = captureDisposition(capture.timestamp, authority);
      if (capture.disposition != null && capture.disposition !== disposition)
        throw new Error('Capture disposition mismatch');
      entry.identity.direction = capture.direction;
      Object.assign(entry, {
        fileIndex,
        offset: line.offset,
        length: line.length,
        sha256: line.sha256,
        captured: true,
        disposition,
      });
      captureCount++;
      if (disposition === 'terminal-diagnostic-only') terminalCaptures++;
    }
  if (index.size !== captureCount)
    throw new Error('Inventory/capture coverage mismatch');
  const fd = fs.openSync(output, 'wx');
  const outputHash = createHash('sha256');
  let rows = 0;
  let terminalCompleted = 0;
  try {
    for (const file of completedInput)
      for await (const { row } of scanJsonLines(file, {
        maxLineBytes,
        canonical: false,
      })) {
        const attempt = binding.attempts.get(row.symbol);
        if (
          !attempt ||
          row.backtestRunId !== binding.actualBacktestRunId ||
          row.configId !== authority.configId ||
          row.strategyName !== authority.strategyName ||
          row.backtestTestKey !== attempt.testKey ||
          row.backtestChunkId !== attempt.chunkId ||
          row.testId !== attempt.testId ||
          row.testSuiteId !== attempt.testSuiteId
        )
          throw new Error('Completed run/config/test binding mismatch');
        const key = keyFor(row);
        const entry = index.get(key);
        if (!entry) throw new Error('Missing decision capture');
        if (entry.completed) throw new Error('Duplicate completed label');
        entry.completed = true;
        const capture = readIndexedCapture(
          capturesInput[entry.fileIndex],
          entry,
          maxLineBytes,
        );
        validateCapture(capture, authority);
        for (const field of identityFields)
          if (row[field] !== capture[field])
            throw new Error(`Completed identity mismatch: ${field}`);
        if (
          typeof row.profit !== 'number' ||
          !Number.isFinite(row.profit) ||
          !finiteInteger(row.tradeResult?.exitTimestamp) ||
          row.tradeResult.exitTimestamp < capture.timestamp
        )
          throw new Error('Invalid completed label horizon');
        const joined = {
          ...row,
          payload: capture.payload,
          timestamp: capture.timestamp,
          decisionCaptureDisposition: entry.disposition,
        };
        // Replacing payload is deliberate. No old future-fill feature survives the join.
        const bytes = canonicalJson(joined) + '\n';
        fs.writeFileSync(fd, bytes);
        outputHash.update(bytes);
        rows++;
        if (entry.disposition === 'terminal-diagnostic-only')
          terminalCompleted++;
      }
    if (!rows) throw new Error('No completed joined labels');
    const after = await hashInputs();
    if (canonicalJson(before) !== canonicalJson(after))
      throw new Error('Join source changed');
    fs.fsyncSync(fd);
    const outputSha256 = outputHash.digest('hex');
    if ((await hashFile(output)).sha256 !== outputSha256)
      throw new Error('Join output readback mismatch');
    const receipt = {
      schema: 'tradejs-decision-capture-join/v2',
      status: 'joined-not-learning-accepted',
      authority,
      actualBacktestRunId: binding.actualBacktestRunId,
      sourceFiles: before,
      output: { path: output, sha256: outputSha256, rows },
      inventory: index.size,
      captures: captureCount,
      completed: rows,
      unmatchedCaptures: captureCount - rows,
      boundary: {
        strictWindowCompleted: rows - terminalCompleted,
        terminalDecisionCaptures: terminalCaptures,
        terminalDecisionCompleted: terminalCompleted,
        terminalDecisionUnmatched: terminalCaptures - terminalCompleted,
        learningWindow: '[windowStart,windowEnd)',
        terminalDisposition: 'diagnostic-only; never learning/selection',
      },
      resources: {
        maxIndexRows,
        maxIndexBytes,
        maxLineBytes,
        maxInputFiles,
        indexRows: index.size,
        accountedIndexBytes: indexBytes,
        accounting:
          '512 bytes/identity + UTF8 key + canonical compact identity + 64 SHA bytes; not exact V8 heap/RSS',
        retainedPayloads: 0,
        randomReadHandles: 1,
        scanChunkBytes: 65536,
      },
      limitations: [
        'Unmatched captures require separate terminal classification.',
        'Worker observations, raw economics reconciliation and actual pilot parity require separate acceptance; this receipt does not authorize learning.',
      ],
    };
    writeExclusiveJson(receiptPath, receipt);
    return receipt;
  } finally {
    fs.closeSync(fd);
  }
};

// The opt-in path indexes only compact native references, reads each capture
// gzip once and restores native row order through bounded compressed spill runs.
export const joinShardedDecisionCaptures = async ({
  projectRoot,
  storageManifests,
  completedFiles,
  outputPath,
  authority,
  runBinding,
  storage,
  discoveryBounds,
  maxIndexRows = 1000000,
  maxIndexBytes = 268435456,
  maxLineBytes = 1048576,
  maxInputFiles = 4096,
}) => {
  const {
    readBoundedFile,
    boundedHash,
    storageLimits,
    createDiskIdentityIndex,
    readStorageManifest,
    readBoundedReference,
    createOrderedShardWriter,
  } = await import('./decision-capture-storage.mjs');
  storageLimits(storage);
  const maxSourceBytes = storage.maxSourceBytes ?? 8589934592;
  if (
    !Number.isSafeInteger(maxSourceBytes) ||
    maxSourceBytes <= 0 ||
    maxSourceBytes > 17179869184
  )
    throw new Error('Invalid source byte bound');
  if (
    !authority?.researchRunId ||
    !authority.configId ||
    !/^[a-f0-9]{64}$/.test(authority.sourceConfigSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(authority.compositionSha256 ?? '') ||
    !Array.isArray(authority.symbols) ||
    !authority.symbols.length ||
    new Set(authority.symbols).size !== authority.symbols.length ||
    !finiteInteger(authority.windowStart) ||
    !finiteInteger(authority.windowEnd) ||
    authority.windowStart >= authority.windowEnd
  )
    throw new Error('Exact external run/config/symbol/window binding required');
  if (
    ![maxIndexRows, maxIndexBytes, maxLineBytes, maxInputFiles].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    !Array.isArray(storageManifests) ||
    !storageManifests.length ||
    !Array.isArray(completedFiles) ||
    !completedFiles.length ||
    storageManifests.length + completedFiles.length + 3 > maxInputFiles
  )
    throw new Error('Bounded nonempty sharded input groups required');
  if (
    discoveryBounds &&
    (!finiteInteger(discoveryBounds.start) ||
      !finiteInteger(discoveryBounds.cutoff) ||
      discoveryBounds.start !== authority.windowStart ||
      discoveryBounds.cutoff <= discoveryBounds.start ||
      discoveryBounds.cutoff > authority.windowEnd)
  )
    throw new Error('Exact maturity-sealed development bounds required');
  const binding = verifyCompletedRunBinding(projectRoot, runBinding, authority);
  const manifestInputs = [];
  const inputDescriptors = [];
  const observations = [];
  const inputPaths = new Set();
  const addDescriptor = (descriptor, maxBytes) => {
    const file = boundPath(projectRoot, descriptor.path);
    if (inputPaths.has(file)) throw new Error('Duplicate sharded input path');
    inputPaths.add(file);
    if (inputPaths.size > maxInputFiles)
      throw new Error('Sharded input file bound exceeded');
    inputDescriptors.push({ ...descriptor, path: file, maxBytes });
    return file;
  };
  for (const descriptor of storageManifests) {
    const file = addDescriptor(descriptor, 16777216);
    const bytes = readBoundedFile(file, 16777216);
    if (sha256(bytes) !== descriptor.sha256)
      throw new Error('Capture manifest checksum mismatch');
    const manifest = JSON.parse(bytes);
    if (
      manifest.schema !== 'tradejs-capture-storage-manifest/v1' ||
      manifest.status !== 'worker-closed-not-run-accepted' ||
      objectSha256(manifest.authority) !== objectSha256(authority)
    )
      throw new Error('Capture manifest authority mismatch');
    const observation = readBoundDescriptor(
      projectRoot,
      manifest.workerObservation,
    );
    if (
      observation.value.schema !== 'tradejs-research-worker-observation/v1' ||
      observation.value.registrySingleton !== true ||
      observation.value.researchRunId !== authority.researchRunId ||
      observation.value.compositionSha256 !== authority.compositionSha256 ||
      observation.value.sourceConfigSha256 !== authority.sourceConfigSha256
    )
      throw new Error('Worker observed composition mismatch');
    addDescriptor(manifest.workerObservation, 65536);
    observations.push(manifest.workerObservation);
    const limits = storageLimits(manifest.storage);
    for (const shard of manifest.shards) {
      addDescriptor(shard.physical, limits.maxArchiveBytes);
      addDescriptor(shard.receipt, limits.maxBuffer);
    }
    manifestInputs.push({ path: file, sha256: descriptor.sha256 });
  }
  for (let i = 0; i < binding.files.length; i++)
    addDescriptor(
      { path: binding.files[i], sha256: binding.expectedHashes[i] },
      16777216,
    );
  const completedInput = completedFiles.map((file) =>
    boundPath(projectRoot, file),
  );
  for (const file of completedInput) {
    if (inputPaths.has(file)) throw new Error('Duplicate completed input');
    inputPaths.add(file);
  }
  if (inputPaths.size > maxInputFiles)
    throw new Error('Sharded input file bound exceeded');
  const output = boundPath(projectRoot, outputPath, false);
  if (
    inputPaths.has(output) ||
    fs.existsSync(`${output}.join-receipt.json`) ||
    fs.existsSync(`${output}.storage.json`)
  )
    throw new Error('Output must be new');
  const before = [];
  for (const descriptor of inputDescriptors) {
    const h = await boundedHash(descriptor.path, descriptor.maxBytes);
    if (h.sha256 !== descriptor.sha256)
      throw new Error('Sharded input checksum mismatch');
    before.push(h);
  }
  let completedSourceBytes = 0;
  for (const file of completedInput) {
    const h = await boundedHash(file, maxSourceBytes);
    completedSourceBytes += h.bytes;
    if (completedSourceBytes > maxSourceBytes)
      throw new Error('Completed source byte bound exceeded');
    before.push(h);
  }
  const nativeBuilder = createDiskIdentityIndex({
    projectRoot,
    directory: `${output}.native-index`,
    maxRows: maxIndexRows,
    maxBytes: maxIndexBytes,
  });
  const maturity = {
    sealedDecisionRows: 0,
    preWindow: 0,
    unknown: 0,
    crossing: 0,
    selected: 0,
  };
  let sequence = 0;
  for (const [fileIndex, file] of completedInput.entries())
    for await (const line of scanJsonLines(file, {
      maxLineBytes,
      canonical: false,
    })) {
      const row = line.row;
      const attempt = binding.attempts.get(row.symbol);
      if (
        !attempt ||
        row.backtestRunId !== binding.actualBacktestRunId ||
        row.configId !== authority.configId ||
        row.strategyName !== authority.strategyName ||
        row.backtestTestKey !== attempt.testKey ||
        row.backtestChunkId !== attempt.chunkId ||
        row.testId !== attempt.testId ||
        row.testSuiteId !== attempt.testSuiteId ||
        !finiteInteger(row.timestamp)
      )
        throw new Error('Completed run/config/test/timestamp binding mismatch');
      const nativeSequence = sequence++;
      if (discoveryBounds && row.timestamp >= discoveryBounds.cutoff) {
        maturity.sealedDecisionRows++;
        continue;
      }
      if (discoveryBounds && row.timestamp < discoveryBounds.start) {
        maturity.preWindow++;
        continue;
      }
      const exit = row.tradeResult?.exitTimestamp;
      if (discoveryBounds && !finiteInteger(exit)) {
        maturity.unknown++;
        continue;
      }
      if (finiteInteger(exit) && exit < row.timestamp)
        throw new Error('Invalid completed label horizon');
      if (discoveryBounds && exit >= discoveryBounds.cutoff) {
        maturity.crossing++;
        continue;
      }
      if (
        !finiteInteger(exit) ||
        typeof row.profit !== 'number' ||
        !Number.isFinite(row.profit)
      )
        throw new Error('Invalid completed label horizon');
      nativeBuilder.append(keyFor(row), {
        fileIndex,
        offset: line.offset,
        length: line.length,
        sha256: line.sha256,
        sequence: nativeSequence,
      });
      maturity.selected++;
    }
  const native = await nativeBuilder.close();
  const identitiesBuilder = createDiskIdentityIndex({
    projectRoot,
    directory: `${output}.capture-index`,
    maxRows: maxIndexRows,
    maxBytes: maxIndexBytes,
  });
  const writer = createOrderedShardWriter({
    projectRoot,
    outputPath: output,
    authority,
    workerObservation: {
      kind: 'joined-own-validated-workers',
      workers: observations,
    },
    storage,
  });
  let captures = 0;
  let inventory = 0;
  let joined = 0;
  let terminal = 0;
  let terminalCompleted = 0;
  const decodeCounts = new Map();
  for (const [workerIndex, descriptor] of manifestInputs.entries())
    for await (const line of readStorageManifest({
      projectRoot,
      descriptor,
      authority,
      expectedStorage: storage,
      onDecode: (file) =>
        decodeCounts.set(file, (decodeCounts.get(file) ?? 0) + 1),
    })) {
      const row = line.row;
      const key = keyFor(row);
      if (
        [
          'researchRunId',
          'compositionSha256',
          'sourceConfigSha256',
          'strategyName',
        ].some((field) => row[field] !== authority[field]) ||
        !authority.symbols.includes(row.symbol)
      )
        throw new Error('Foreign capture record authority');
      const disposition = captureDisposition(row.timestamp, authority);
      if (row.schema === 'tradejs-entry-inventory/v1') {
        identitiesBuilder.append(`${key}\0I`, {
          kind: 'inventory',
          key,
          timestamp: row.timestamp,
        });
        inventory++;
        continue;
      }
      if (row.schema === 'tradejs-entry-gate-observation/v1') {
        identitiesBuilder.append(`${key}\0G`, {
          kind: 'gate',
          key,
          timestamp: row.timestamp,
          payloadSha256: row.payloadSha256,
          allow: row.allow,
        });
        continue;
      }
      if (row.schema !== 'tradejs-research-decision-capture/v1')
        throw new Error('Unknown capture record schema');
      const eligible =
        !discoveryBounds || row.timestamp < discoveryBounds.cutoff;
      const reference = eligible ? native.get(key, true) : null;
      // Purged/crossing/test rows never undergo feature/payload validation or gate evaluation.
      if (eligible && (!discoveryBounds || reference))
        validateCapture(row, authority);
      if (row.workerObservationSha256 !== observations[workerIndex].sha256)
        throw new Error('Capture/worker observation mismatch');
      identitiesBuilder.append(`${key}\0C`, {
        kind: 'capture',
        key,
        timestamp: row.timestamp,
        direction: row.direction,
        payloadSha256: row.payloadSha256,
        completed: !!reference,
      });
      captures++;
      if (disposition === 'terminal-diagnostic-only') terminal++;
      if (!reference) continue;
      const completed = readBoundedReference(
        completedInput[reference.fileIndex],
        reference,
        maxLineBytes,
      );
      if (identityFields.some((field) => completed[field] !== row[field]))
        throw new Error('Completed identity mismatch');
      writer.append(reference.sequence, {
        ...completed,
        payload: row.payload,
        timestamp: row.timestamp,
        decisionCaptureDisposition: disposition,
      });
      joined++;
      if (disposition === 'terminal-diagnostic-only') terminalCompleted++;
    }
  const identities = await identitiesBuilder.close();
  let observedVetoUnmatched = 0;
  for await (const { row: entry } of identities.entries()) {
    const record = entry.value;
    if (record.kind === 'inventory') {
      const capture = identities.get(`${record.key}\0C`);
      if (!capture || capture.timestamp !== record.timestamp)
        throw new Error('Inventory/capture coverage mismatch');
    }
    if (record.kind === 'capture') {
      const original = identities.get(`${record.key}\0I`);
      if (!original || original.timestamp !== record.timestamp)
        throw new Error('Missing original inventory');
      const gate = identities.get(`${record.key}\0G`);
      if (
        gate &&
        (gate.timestamp !== record.timestamp ||
          gate.payloadSha256 !== record.payloadSha256 ||
          typeof gate.allow !== 'boolean')
      )
        throw new Error('Gate/capture observation mismatch');
      if (!record.completed && gate?.allow === false) observedVetoUnmatched++;
    }
    if (record.kind === 'gate' && !identities.get(`${record.key}\0C`))
      throw new Error('Gate without capture');
  }
  if (inventory !== captures || joined !== native.rows)
    throw new Error('Global completed/capture bijection mismatch');
  await native.verify();
  await identities.verify();
  const verifyInputs = async () => {
    for (const prior of before) {
      const limit =
        inputDescriptors.find((item) => item.path === prior.path)?.maxBytes ??
        maxSourceBytes;
      if (
        canonicalJson(prior) !==
        canonicalJson(await boundedHash(prior.path, limit))
      )
        throw new Error('Join source changed');
    }
  };
  await verifyInputs();
  const result = await writer.close();
  await verifyInputs();
  const receipt = {
    schema: 'tradejs-decision-capture-sharded-join/v1',
    status: 'joined-not-learning-accepted',
    authority,
    actualBacktestRunId: binding.actualBacktestRunId,
    sourceFiles: before,
    output: result.descriptor,
    inventory,
    captures,
    completed: joined,
    unmatchedCaptures: captures - joined,
    unmatched: {
      observedVeto: observedVetoUnmatched,
      unclassified: captures - joined - observedVetoUnmatched,
      requiresSeparateLifecycleClassification: true,
    },
    boundary: {
      strictWindowCompleted: joined - terminalCompleted,
      terminalDecisionCaptures: terminal,
      terminalDecisionCompleted: terminalCompleted,
      learningWindow: '[windowStart,windowEnd)',
    },
    ...(discoveryBounds ? { discoveryBounds, maturity } : {}),
    resources: {
      native: native.resources,
      captureIdentities: identities.resources,
      output: result.resources,
      captureArchiveDecodes: [...decodeCounts.values()].reduce(
        (a, b) => a + b,
        0,
      ),
      maximumDecodesPerCaptureArchive: Math.max(0, ...decodeCounts.values()),
      noWholeDatasetPayloadIndex: true,
      indexValuePolicy: 'compact identities/offsets only in this join',
      payloadBuffering:
        'complete joined rows in bounded ordered sort and merge heads; not payload-free',
    },
    limitations: [
      'No learning acceptance; actual full coverage, raw economics reconciliation and unmatched lifecycle classification require independent review.',
      'Native gzip ingestion is unsupported; a separately reviewed permanent maturity-purged DEV view is required.',
    ],
  };
  writeExclusiveJson(`${output}.join-receipt.json`, receipt);
  return receipt;
};

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 3)
    throw new Error(
      'Usage: decision-capture-join.mjs <verified-join-request.json>',
    );
  const request = JSON.parse(fs.readFileSync(process.argv[2]));
  console.log(JSON.stringify(await joinDecisionCaptures(request)));
}
