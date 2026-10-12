import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { canonicalJson, sha256 } from './decision-capture-join.mjs';
import {
  boundedHash,
  storageLimits,
  createShardedCaptureSink,
  readStorageManifest,
  readArchiveBytes,
  scanCanonicalChunks,
  sealShard,
  createDiskIdentityIndex,
  readBoundedReference,
  readBoundedFile,
  createOrderedShardWriter,
} from './decision-capture-storage.mjs';

const helper = fileURLToPath(
  new URL('./decision-capture-storage.mjs', import.meta.url),
);
const fixture = (t, overrides = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const storage = {
    schema: 'tradejs-capture-stream-storage/v1',
    maxShardBytes: 256,
    maxLineBytes: 128,
    maxArchiveBytes: 1024,
    reclaimPlain: false,
    helperSha256: sha256(fs.readFileSync(helper)),
    ...overrides,
  };
  const authority = { researchRunId: 'own', compositionSha256: 'a'.repeat(64) };
  const sink = () =>
    createShardedCaptureSink({
      projectRoot: root,
      outputPath: 'own',
      authority,
      workerObservation: { path: 'observation', sha256: 'b'.repeat(64) },
      storage,
    });
  const descriptor = () => ({
    path: 'own.storage.json',
    sha256: sha256(fs.readFileSync(path.join(root, 'own.storage.json'))),
  });
  return { root, storage, authority, sink, descriptor };
};
const collect = async (iterable) => {
  const rows = [];
  for await (const line of iterable) rows.push(line);
  return rows;
};

test('opt-in canonical sharding preserves concatenated logical identity, Unicode and ONE decode per archive', async (t) => {
  const f = fixture(t);
  const sink = f.sink();
  const rows = Array.from({ length: 20 }, (_, n) => ({
    n,
    name: 'Ё🙂'.repeat(3),
  }));
  rows.forEach((row) => sink.append(row));
  const manifest = sink.close();
  assert.equal(
    manifest.logicalSha256,
    sha256(rows.map((r) => canonicalJson(r) + '\n').join('')),
  );
  assert.ok(manifest.shards.length > 1);
  const decoded = [];
  const result = await collect(
    readStorageManifest({
      projectRoot: f.root,
      descriptor: f.descriptor(),
      authority: f.authority,
      expectedStorage: f.storage,
      onDecode: (file) => decoded.push(file),
    }),
  );
  assert.deepEqual(
    result.map((r) => r.row),
    rows,
  );
  assert.equal(new Set(decoded).size, manifest.shards.length);
  assert.equal(decoded.length, manifest.shards.length);
  assert.equal(manifest.resources.maxPendingArchives, 1);
  assert.equal(manifest.resources.wholePayloadsRetained, 0);
});

test('rotation boundaries do not change logical hash', (t) => {
  const a = fixture(t);
  const b = fixture(t, { maxShardBytes: 512 });
  const rows = Array.from({ length: 16 }, (_, n) => ({ n }));
  const sa = a.sink();
  const sb = b.sink();
  rows.forEach((r) => {
    sa.append(r);
    sb.append(r);
  });
  assert.equal(sa.close().logicalSha256, sb.close().logicalSha256);
});

test('sealed receipt remains available before global worker manifest; no actual reclamation by default', (t) => {
  const f = fixture(t);
  const s = f.sink();
  for (let n = 0; n < 20; n++) s.append({ n, text: 'x'.repeat(32) });
  assert.ok(
    fs.existsSync(path.join(f.root, 'own.part1.jsonl.gz.receipt.json')),
  );
  assert.ok(fs.existsSync(path.join(f.root, 'own.part1.jsonl')));
  assert.equal(fs.existsSync(path.join(f.root, 'own.storage.json')), false);
  s.close();
});

test('process.exit final close synchronously flushes bounded inherited archive child', (t) => {
  const f = fixture(t);
  const code = `import {createShardedCaptureSink} from ${JSON.stringify(helper)};const s=createShardedCaptureSink(${JSON.stringify({ projectRoot: f.root, outputPath: 'own', authority: f.authority, workerObservation: {}, storage: f.storage })});s.append({n:1});process.once('exit',()=>s.close());process.exit(0);`;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code],
    { timeout: 10000, maxBuffer: 65536, detached: false, shell: false },
  );
  assert.equal(child.status, 0, child.stderr?.toString());
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, 'own.storage.json'))).rows,
    1,
  );
});

test('archive child timeout blocks global success and retains own partial source', (t) => {
  const f = fixture(t, { timeoutMs: 1 });
  const s = f.sink();
  s.append({ n: 1 });
  assert.throws(() => s.close(), /Archive child failed/);
  assert.equal(fs.existsSync(path.join(f.root, 'own.storage.json')), false);
  assert.ok(fs.existsSync(path.join(f.root, 'own.part1.jsonl')));
  assert.throws(() => s.append({ n: 2 }), /closed\/failed/);
});

for (const kind of [
  'foreign-authority',
  'wrong-descriptor',
  'duplicate-shard',
  'partial-status',
])
  test(`manifest rejects ${kind}`, async (t) => {
    const f = fixture(t);
    const s = f.sink();
    s.append({ n: 1 });
    const m = s.close();
    if (kind === 'foreign-authority') m.authority.researchRunId = 'foreign';
    if (kind === 'wrong-descriptor')
      m.shards[0].physical.sha256 = '0'.repeat(64);
    if (kind === 'duplicate-shard') m.shards.push({ ...m.shards[0] });
    if (kind === 'partial-status') m.status = 'running';
    fs.writeFileSync(path.join(f.root, 'own.storage.json'), canonicalJson(m));
    await assert.rejects(
      collect(
        readStorageManifest({
          projectRoot: f.root,
          descriptor: f.descriptor(),
          authority: f.authority,
          expectedStorage: f.storage,
        }),
      ),
      /mismatch|Duplicate|invalid/,
    );
  });

for (const text of ['{"z":1,"a":2}\n', '{"a":1}\r\n', '{"a":1}', '\n'])
  test(`reject noncanonical bytes ${JSON.stringify(text)}`, async () => {
    await assert.rejects(
      collect(scanCanonicalChunks([Buffer.from(text)], 128)),
      /Noncanonical|Canonical|Unterminated|bound/,
    );
  });

test('UTF8 bytes split across chunks stay canonical and byte offsets correct', async () => {
  const bytes = Buffer.from(canonicalJson({ s: '🙂' }) + '\n');
  const lines = await collect(
    scanCanonicalChunks(
      Array.from(bytes, (b) => Buffer.from([b])),
      128,
    ),
  );
  assert.equal(lines[0].length, bytes.length);
  assert.equal(lines[0].offset, 0);
  await assert.rejects(
    collect(scanCanonicalChunks([Buffer.from([255, 10])], 128)),
    /encoded|encoding/,
  );
});

test('huge line and invalid positive-safe resource limits fail before archive', (t) => {
  const f = fixture(t);
  const s = f.sink();
  assert.throws(() => s.append({ huge: 'x'.repeat(256) }), /line byte/);
  for (const n of [0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => storageLimits({ ...f.storage, maxShardBytes: n }),
      /Invalid/,
    );
  assert.equal(fs.existsSync(path.join(f.root, 'own.storage.json')), false);
});

test('wx collision preserves source and emits no successful global authority', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'own.part1.jsonl'), 'foreign');
  const s = f.sink();
  assert.throws(() => s.append({ n: 1 }), /EEXIST/);
  assert.equal(
    fs.readFileSync(path.join(f.root, 'own.part1.jsonl'), 'utf8'),
    'foreign',
  );
  assert.equal(fs.existsSync(path.join(f.root, 'own.storage.json')), false);
});

test('paths outside root and symlink output parents reject', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createShardedCaptureSink({
        projectRoot: f.root,
        outputPath: '../foreign',
        storage: f.storage,
      }),
    /outside/,
  );
  fs.mkdirSync(path.join(f.root, 'actual'));
  fs.symlinkSync(path.join(f.root, 'actual'), path.join(f.root, 'link'));
  assert.throws(
    () =>
      createShardedCaptureSink({
        projectRoot: f.root,
        outputPath: 'link/out',
        storage: f.storage,
      }),
    /Symlink/,
  );
});

test('archive corruption/truncation and trailing bytes reject even with updated physical descriptor', async (t) => {
  const f = fixture(t);
  const s = f.sink();
  s.append({ n: 1 });
  const m = s.close();
  const d = m.shards[0];
  const original = fs.readFileSync(d.physical.path);
  for (const bytes of [
    original.subarray(0, -1),
    Buffer.concat([original, Buffer.from([0])]),
    Buffer.concat([original, original]),
  ]) {
    fs.writeFileSync(d.physical.path, bytes);
    const physical = await boundedHash(d.physical.path, 1024);
    await assert.rejects(
      collect(
        readArchiveBytes(
          d.physical.path,
          { ...d, physical },
          storageLimits(f.storage),
        ),
      ),
    );
  }
});

test('decompression byte limit rejects compressed bomb without giant decoded allocation', async (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'bomb.gz');
  fs.writeFileSync(file, gzipSync('x'.repeat(100000)));
  const physical = await boundedHash(file, 1024);
  await assert.rejects(
    collect(
      readArchiveBytes(
        file,
        { physical, logical: { bytes: 256, sha256: 'a'.repeat(64) } },
        storageLimits(f.storage),
      ),
    ),
    /Decoded byte bound/,
  );
});

test('disk identity index spills bounded compact records, exact dedup, matched bit and one bounded lookup', async (t) => {
  const f = fixture(t);
  const builder = createDiskIdentityIndex({
    projectRoot: f.root,
    directory: 'idx',
    maxSortBytes: 1024,
    maxRecordBytes: 512,
    maxRows: 500,
    maxBytes: 100000,
  });
  for (let n = 149; n >= 0; n--)
    builder.append('🙂' + n, { n, file: 1, offset: n * 20, length: 20 });
  const index = await builder.close();
  assert.equal(index.rows, 150);
  assert.ok(index.resources.peakLogicalSortBytes <= 1024);
  assert.equal(
    index.resources.indexValuePolicy,
    'caller-provided bounded JSON; payload-free not guaranteed',
  );
  assert.ok(index.resources.peakBufferedRecords > 0);
  assert.deepEqual(index.get('🙂42', true), {
    n: 42,
    file: 1,
    offset: 840,
    length: 20,
  });
  assert.throws(() => index.get('🙂42', true), /Duplicate matched/);
  assert.equal(index.get('absent'), null);
  await index.verify();
});

test('duplicate disk identities and row/byte limits fail closed', async (t) => {
  const f = fixture(t);
  const b = createDiskIdentityIndex({ projectRoot: f.root, directory: 'idx' });
  b.append('same', { x: 1 });
  b.append('same', { x: 2 });
  await assert.rejects(b.close(), /Duplicate disk identity/);
  const limited = createDiskIdentityIndex({
    projectRoot: f.root,
    directory: 'limited',
    maxRows: 1,
  });
  limited.append('a', {});
  assert.throws(() => limited.append('b', {}), /resource bound/);
});

test('archive child explicitly proves same inherited PGID and exact parent PID', (t) => {
  const f = fixture(t);
  const s = f.sink();
  s.append({ n: 1 });
  const m = s.close();
  const receipt = JSON.parse(fs.readFileSync(m.shards[0].receipt.path));
  const pgid = Number(
    spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'pgid='], {
      encoding: 'utf8',
    }).stdout.trim(),
  );
  assert.equal(receipt.archiveChild.ppid, process.pid);
  assert.equal(receipt.archiveChild.pgid, pgid);
  assert.notEqual(receipt.archiveChild.pid, process.pid);
});

test('bounded file hash/read reject oversized inputs without retaining giant data', async (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'big');
  fs.writeFileSync(file, 'x'.repeat(256));
  await assert.rejects(boundedHash(file, 128), /byte bound/);
  assert.throws(() => readBoundedFile(file, 128), /byte bound/);
});

test('row reference offsets/full hashes and disk-index mutation fail closed', async (t) => {
  const f = fixture(t);
  const file = path.join(f.root, 'rows');
  const bytes = Buffer.from('{"n":1}\n');
  fs.writeFileSync(file, bytes);
  const ref = { offset: 0, length: bytes.length, sha256: sha256(bytes) };
  assert.deepEqual(readBoundedReference(file, ref, 128), { n: 1 });
  assert.throws(
    () => readBoundedReference(file, { ...ref, offset: 1 }, 128),
    /LF boundary/,
  );
  fs.writeFileSync(file, '{"n":2}\n');
  assert.throws(() => readBoundedReference(file, ref, 128), /checksum/);
  const b = createDiskIdentityIndex({ projectRoot: f.root, directory: 'idx' });
  b.append('key', { n: 1 });
  const index = await b.close();
  const data = path.join(f.root, 'idx', 'merge-0-0.jsonl');
  fs.writeFileSync(
    data,
    fs.readFileSync(data, 'utf8').replace('"n":1', '"n":2'),
  );
  assert.throws(() => index.get('key'), /reference mismatch/);
  await assert.rejects(index.verify(), /changed/);
});

test('disk physical/run/merge bounds prevent unlimited temporary growth', async (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createDiskIdentityIndex({
        projectRoot: f.root,
        directory: 'bad',
        fanIn: 1,
      }),
    /Invalid/,
  );
  const b = createDiskIdentityIndex({
    projectRoot: f.root,
    directory: 'limited-disk',
    maxDiskBytes: 100,
  });
  b.append('key', { n: 1 });
  await assert.rejects(b.close(), /physical byte bound/);
  const r = createDiskIdentityIndex({
    projectRoot: f.root,
    directory: 'limited-runs',
    maxSortBytes: 128,
    maxRecordBytes: 128,
    maxRuns: 1,
  });
  r.append('one', {});
  r.append('two', {});
  assert.throws(() => r.append('three', {}), /run bound/);
});

test('ordered compressed spills retain native sequence with bounded payload sorting', async (t) => {
  const f = fixture(t, {
    maxShardBytes: 1024,
    maxLineBytes: 512,
    maxArchiveBytes: 2048,
  });
  const writer = createOrderedShardWriter({
    projectRoot: f.root,
    outputPath: 'ordered',
    authority: f.authority,
    workerObservation: {},
    storage: f.storage,
    maxSortBytes: 256,
    fanIn: 2,
  });
  for (let n = 19; n >= 0; n--) writer.append(n, { n, text: 'x'.repeat(32) });
  const result = await writer.close();
  assert.ok(result.resources.peakLogicalSortBytes <= 256);
  assert.ok(result.resources.peakBufferedPayloadRows > 0);
  assert.ok(result.resources.peakMergeHeadRows > 0);
  assert.ok(result.resources.peakMergeHeadRows <= 2);
  const rows = await collect(
    readStorageManifest({
      projectRoot: f.root,
      descriptor: result.descriptor,
      authority: f.authority,
      expectedStorage: f.storage,
    }),
  );
  assert.deepEqual(
    rows.map((r) => r.row.n),
    Array.from({ length: 20 }, (_, n) => n),
  );
});

for (const kind of ['missing', 'wrong-helper', 'changed-policy'])
  test(`reader requires exact expected storage before decoding: ${kind}`, async (t) => {
    const f = fixture(t);
    const sink = f.sink();
    sink.append({ n: 1 });
    sink.close();
    let decodes = 0;
    const expectedStorage =
      kind === 'missing'
        ? undefined
        : {
            ...f.storage,
            ...(kind === 'wrong-helper'
              ? { helperSha256: '0'.repeat(64) }
              : { maxShards: 2 }),
          };
    await assert.rejects(
      collect(
        readStorageManifest({
          projectRoot: f.root,
          descriptor: f.descriptor(),
          authority: f.authority,
          expectedStorage,
          onDecode: () => decodes++,
        }),
      ),
      /schema|helper|authority mismatch/,
    );
    assert.equal(decodes, 0);
  });

test('reader rechecks executing helper before successful completion without source writes', async (t) => {
  const f = fixture(t);
  const sink = f.sink();
  sink.append({ n: 1 });
  sink.close();
  const open = fs.openSync;
  const read = fs.readSync;
  const close = fs.closeSync;
  let afterDecode = false;
  const changed = new Map();
  fs.openSync = (file, ...args) => {
    const fd = open(file, ...args);
    if (file === helper && afterDecode) changed.set(fd, false);
    return fd;
  };
  fs.readSync = (fd, buffer, offset, length, position) => {
    if (!changed.has(fd)) return read(fd, buffer, offset, length, position);
    if (changed.get(fd)) return 0;
    changed.set(fd, true);
    return Buffer.from('synthetic changed helper').copy(
      buffer,
      offset,
      0,
      length,
    );
  };
  fs.closeSync = (fd) => {
    changed.delete(fd);
    return close(fd);
  };
  try {
    await assert.rejects(
      collect(
        readStorageManifest({
          projectRoot: f.root,
          descriptor: f.descriptor(),
          authority: f.authority,
          expectedStorage: f.storage,
          onDecode: () => {
            afterDecode = true;
          },
        }),
      ),
      /executing storage helper checksum mismatch/,
    );
    assert.equal(changed.size, 0);
  } finally {
    fs.openSync = open;
    fs.readSync = read;
    fs.closeSync = close;
  }
});

test('generic disk index permits bounded payload values without claiming payload-free retention', async (t) => {
  const f = fixture(t);
  const builder = createDiskIdentityIndex({
    projectRoot: f.root,
    directory: 'payload-index',
    maxSortBytes: 1024,
    maxRecordBytes: 512,
  });
  const value = { payload: { features: { text: '🙂'.repeat(20) } } };
  builder.append('payload', value);
  const index = await builder.close();
  assert.deepEqual(index.get('payload'), value);
  assert.equal(index.resources.retainedPayloads, undefined);
  assert.match(index.resources.indexValuePolicy, /payload-free not guaranteed/);
  assert.equal(index.resources.peakBufferedRecords, 1);
  assert.ok(index.resources.peakLogicalSortBytes > 0);
});

test('repeated archive EEXIST closes synchronous and asynchronous source handles', async (t) => {
  const f = fixture(t);
  const s = f.sink();
  s.append({ n: 1 });
  const m = s.close();
  const shard = m.shards[0];
  fs.unlinkSync(shard.receipt.path);
  const live = new Set();
  const originals = {
    open: fs.open,
    close: fs.close,
    openSync: fs.openSync,
    closeSync: fs.closeSync,
  };
  fs.open = function (...args) {
    const cb = args.pop();
    return originals.open.call(fs, ...args, (error, fd) => {
      if (!error) live.add(fd);
      cb(error, fd);
    });
  };
  fs.close = function (fd, cb) {
    return originals.close.call(fs, fd, (error) => {
      if (!error) live.delete(fd);
      cb(error);
    });
  };
  fs.openSync = function (...args) {
    const fd = originals.openSync.apply(fs, args);
    live.add(fd);
    return fd;
  };
  fs.closeSync = function (fd) {
    originals.closeSync.call(fs, fd);
    live.delete(fd);
  };
  try {
    for (let n = 0; n < 3; n++)
      await assert.rejects(
        sealShard({
          projectRoot: f.root,
          file: shard.logical.path,
          archive: shard.physical.path,
          receiptPath: shard.receipt.path,
          logical: shard.logical,
          rows: shard.rows,
          authority: f.authority,
          storage: f.storage,
        }),
        /EEXIST/,
      );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(live.size, 0);
    assert.equal(fs.existsSync(shard.receipt.path), false);
  } finally {
    Object.assign(fs, originals);
  }
});

test('source mutation during decoded streaming rejects immutable archive success', async (t) => {
  const f = fixture(t);
  const s = f.sink();
  s.append({ n: 1 });
  const m = s.close();
  const shard = m.shards[0];
  const reader = readArchiveBytes(
    shard.physical.path,
    shard,
    storageLimits(f.storage),
  );
  assert.equal((await reader.next()).done, false);
  fs.appendFileSync(shard.physical.path, Buffer.from([0]));
  await assert.rejects(collect(reader), /changed|mismatch/);
});

test('failed exit-event flush cannot masquerade as complete capture even with requested exit0', (t) => {
  const f = fixture(t, { timeoutMs: 1 });
  const code = `import {createShardedCaptureSink} from ${JSON.stringify(helper)};const s=createShardedCaptureSink(${JSON.stringify({ projectRoot: f.root, outputPath: 'own', authority: f.authority, workerObservation: {}, storage: f.storage })});s.append({n:1});process.once('exit',()=>s.close());process.exit(0);`;
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code],
    { timeout: 10000, maxBuffer: 65536, shell: false, detached: false },
  );
  // Explicit native process.exit(0) keeps status0 despite an exit-listener throw.
  // Only the COMPLETE artifact barrier can authorize capture, never this status.
  assert.equal(child.status, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'own.storage.json')), false);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, 'own.storage-failed.json')))
      .status,
    'failed-no-complete-authority',
  );
});

test('empty ordered writer never fabricates zero labels/export', async (t) => {
  const f = fixture(t);
  const writer = createOrderedShardWriter({
    projectRoot: f.root,
    outputPath: 'empty',
    authority: f.authority,
    workerObservation: {},
    storage: f.storage,
  });
  await assert.rejects(writer.close(), /No completed joined labels/);
  assert.equal(fs.existsSync(path.join(f.root, 'empty.storage.json')), false);
});
