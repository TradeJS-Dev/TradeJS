import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip, createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  boundPath,
  canonicalJson,
  sha256,
  writeExclusiveJson,
} from './decision-capture-join.mjs';

const helperPath = fileURLToPath(import.meta.url);
const positive = (n) => Number.isSafeInteger(n) && n > 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const ownPgid = () => {
  if (!['darwin', 'linux'].includes(process.platform))
    throw new Error('Owned archive PGID proof unsupported on this platform');
  const result = spawnSync(
    '/bin/ps',
    ['-p', String(process.pid), '-o', 'pgid='],
    {
      shell: false,
      detached: false,
      timeout: 1000,
      maxBuffer: 1024,
      encoding: 'utf8',
    },
  );
  const pgid = Number(result.stdout?.trim());
  if (result.error || result.status !== 0 || !positive(pgid))
    throw new Error('Owned archive PGID proof unavailable');
  return pgid;
};
export const readBoundedFile = (file, maxBytes) => {
  if (!positive(maxBytes)) throw new Error('Invalid read byte bound');
  const fd = fs.openSync(file, 'r');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maxBytes + 1 - bytes));
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!n) break;
      bytes += n;
      if (bytes > maxBytes) throw new Error('Read byte bound exceeded');
      chunks.push(buffer.subarray(0, n));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    fs.closeSync(fd);
  }
};
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crcUpdate = (crc, bytes) => {
  for (const n of bytes) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  return crc >>> 0;
};
export const storageLimits = (value) => {
  if (value?.schema !== 'tradejs-capture-stream-storage/v1')
    throw new Error('Explicit storage schema required');
  const limits = {
    maxShardBytes: value.maxShardBytes ?? 67108864,
    maxLineBytes: value.maxLineBytes ?? 1048576,
    maxArchiveBytes: value.maxArchiveBytes ?? 67239936,
    maxShards: value.maxShards ?? 4096,
    timeoutMs: value.timeoutMs ?? 120000,
    maxBuffer: value.maxBuffer ?? 65536,
    gzipLevel: value.gzipLevel ?? 6,
  };
  if (
    Object.values(limits).some((n) => !positive(n)) ||
    limits.maxShardBytes > 67108864 ||
    limits.maxLineBytes > 1048576 ||
    limits.maxLineBytes + 1 > limits.maxShardBytes ||
    limits.maxArchiveBytes > 134217728 ||
    limits.maxShards > 65536 ||
    limits.timeoutMs > 120000 ||
    limits.maxBuffer > 65536 ||
    limits.gzipLevel > 9
  )
    throw new Error('Invalid bounded storage limits');
  if (value.reclaimPlain !== false && value.reclaimPlain !== true)
    throw new Error('Explicit reclaimPlain policy required');
  return limits;
};

export const boundedHash = async (file, maxBytes) => {
  if (!positive(maxBytes)) throw new Error('Invalid hash byte bound');
  let bytes = 0;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, {
    highWaterMark: 65536,
  })) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('File byte bound exceeded');
    hash.update(chunk);
  }
  return { path: file, bytes, sha256: hash.digest('hex') };
};

// Decode exactly one canonical gzip member: no optional headers, trailing data,
// concatenated members, replacement UTF8 or unbounded decompression.
export const readArchiveBytes = async function* (file, descriptor, limits) {
  const before = await boundedHash(file, limits.maxArchiveBytes);
  if (!same(before, descriptor.physical))
    throw new Error('Archive input mismatch');
  if (before.bytes < 18) throw new Error('Truncated gzip');
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(10);
  const trailer = Buffer.alloc(8);
  try {
    if (
      fs.readSync(fd, header, 0, 10, 0) !== 10 ||
      fs.readSync(fd, trailer, 0, 8, before.bytes - 8) !== 8 ||
      header[0] !== 31 ||
      header[1] !== 139 ||
      header[2] !== 8 ||
      header[3] !== 0 ||
      header.readUInt32LE(4) !== 0
    )
      throw new Error('Noncanonical gzip header');
  } finally {
    fs.closeSync(fd);
  }
  const input = fs.createReadStream(file, {
    start: 10,
    end: before.bytes - 9,
    highWaterMark: 65536,
  });
  const inflate = createInflateRaw({ chunkSize: 65536 });
  const feed = pipeline(input, inflate).catch((error) => {
    inflate.destroy(error);
  });
  let bytes = 0;
  let crc = 0xffffffff;
  const hash = createHash('sha256');
  try {
    for await (const chunk of inflate) {
      bytes += chunk.length;
      if (bytes > limits.maxShardBytes || bytes > descriptor.logical.bytes)
        throw new Error('Decoded byte bound exceeded');
      crc = crcUpdate(crc, chunk);
      hash.update(chunk);
      yield chunk;
    }
    await feed;
    if (
      inflate.bytesWritten !== before.bytes - 18 ||
      (crc ^ 0xffffffff) >>> 0 !== trailer.readUInt32LE(0) ||
      bytes >>> 0 !== trailer.readUInt32LE(4) ||
      bytes !== descriptor.logical.bytes ||
      hash.digest('hex') !== descriptor.logical.sha256
    )
      throw new Error('Gzip member/logical checksum mismatch');
    const after = await boundedHash(file, limits.maxArchiveBytes);
    if (!same(before, after)) throw new Error('Archive source changed');
  } finally {
    input.destroy();
    inflate.destroy();
    await feed;
  }
};

export const scanCanonicalChunks = async function* (chunks, maxLineBytes) {
  if (!positive(maxLineBytes)) throw new Error('Invalid line bound');
  let pending = Buffer.alloc(0);
  let offset = 0;
  for await (const chunk of chunks) {
    let start = 0;
    for (let end = 0; end < chunk.length; end++) {
      if (chunk[end] !== 10) continue;
      const length = pending.length + end - start;
      if (!length || length > maxLineBytes)
        throw new Error('JSON line byte bound exceeded');
      const bytes = Buffer.concat([pending, chunk.subarray(start, end)]);
      if (bytes.includes(13)) throw new Error('Canonical LF required');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const row = JSON.parse(text);
      if (canonicalJson(row) !== text) throw new Error('Noncanonical JSON');
      yield {
        row,
        offset,
        length: length + 1,
        sha256: sha256(Buffer.concat([bytes, Buffer.from('\n')])),
      };
      offset += length + 1;
      start = end + 1;
      pending = Buffer.alloc(0);
    }
    if (pending.length + chunk.length - start > maxLineBytes)
      throw new Error('JSON line byte bound exceeded');
    pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (pending.length) throw new Error('Unterminated JSONL');
};

export const sealShard = async (request) => {
  const childProof = { pid: process.pid, ppid: process.ppid, pgid: ownPgid() };
  if (
    request.expectedParent &&
    (request.expectedParent.pid !== childProof.ppid ||
      request.expectedParent.pgid !== childProof.pgid)
  )
    throw new Error('Archive child ownership mismatch');
  const limits = storageLimits(request.storage);
  const root = fs.realpathSync(request.projectRoot);
  const file = boundPath(root, request.file);
  const archive = boundPath(root, request.archive, false);
  const receiptPath = boundPath(root, request.receiptPath, false);
  if (archive !== `${file}.gz` || receiptPath !== `${archive}.receipt.json`)
    throw new Error('Exact own archive paths required');
  if (fs.existsSync(receiptPath)) throw new Error('Archive receipt exists');
  const before = await boundedHash(file, limits.maxShardBytes);
  if (!same(before, request.logical)) throw new Error('Sealed shard mismatch');
  let count = 0;
  for await (const _line of scanCanonicalChunks(
    fs.createReadStream(file, { highWaterMark: 65536 }),
    limits.maxLineBytes,
  ))
    count++;
  if (count !== request.rows) throw new Error('Shard row count mismatch');
  let physicalBytes = 0;
  const bound = new Transform({
    transform(chunk, _encoding, callback) {
      physicalBytes += chunk.length;
      callback(
        physicalBytes > limits.maxArchiveBytes
          ? new Error('Archive byte bound exceeded')
          : null,
        chunk,
      );
    },
  });
  await pipeline(
    fs.createReadStream(file, { highWaterMark: 65536 }),
    createGzip({ level: limits.gzipLevel, chunkSize: 65536 }),
    bound,
    fs.createWriteStream(archive, { flags: 'wx', highWaterMark: 65536 }),
  );
  const archiveFd = fs.openSync(archive, 'r');
  try {
    fs.fsyncSync(archiveFd);
  } finally {
    fs.closeSync(archiveFd);
  }
  const physical = await boundedHash(archive, limits.maxArchiveBytes);
  const descriptor = { logical: before, physical, rows: count };
  let decodedRows = 0;
  for await (const _line of scanCanonicalChunks(
    readArchiveBytes(archive, descriptor, limits),
    limits.maxLineBytes,
  ))
    decodedRows++;
  if (
    decodedRows !== count ||
    !same(before, await boundedHash(file, limits.maxShardBytes))
  )
    throw new Error('Archive readback/source mismatch');
  const receipt = {
    schema: 'tradejs-sealed-capture-shard/v1',
    status: 'archived-not-run-accepted',
    authority: request.authority,
    helperSha256: sha256(fs.readFileSync(helperPath)),
    node: process.version,
    archiveChild: childProof,
    gzipLevel: limits.gzipLevel,
    ...descriptor,
  };
  writeExclusiveJson(receiptPath, receipt);
  return receipt;
};

export const createShardedCaptureSink = ({
  projectRoot,
  outputPath,
  authority,
  workerObservation,
  storage,
}) => {
  const limits = storageLimits(storage);
  if (storage.helperSha256 !== sha256(fs.readFileSync(helperPath)))
    throw new Error('Archive helper checksum mismatch');
  const prefix = boundPath(projectRoot, outputPath, false);
  const manifestPath = `${prefix}.storage.json`;
  if (fs.existsSync(manifestPath)) throw new Error('Storage manifest exists');
  let fd = null;
  let file;
  let count = 0;
  let rows = 0;
  let bytes = 0;
  let closed = false;
  let failed = false;
  let shardHash;
  let inventorySidecar;
  const whole = createHash('sha256');
  const shards = [];
  const fail = () => {
    failed = true;
    if (fd != null) {
      fs.closeSync(fd);
      fd = null;
    }
    inventorySidecar?.abort();
    const failurePath = `${prefix}.storage-failed.json`;
    if (!fs.existsSync(failurePath)) {
      try {
        writeExclusiveJson(failurePath, {
          schema: 'tradejs-capture-storage-failure/v1',
          status: 'failed-no-complete-authority',
          authority,
          helperSha256: storage.helperSha256,
          sealedShards: shards.length,
        });
      } catch {
        /* Missing COMPLETE manifest remains fail-closed even if failure marker I/O also fails. */
      }
    }
  };
  const open = () => {
    if (shards.length >= limits.maxShards)
      throw new Error('Shard count bound exceeded');
    file = `${prefix}.part${shards.length + 1}.jsonl`;
    fd = fs.openSync(file, 'wx');
    bytes = 0;
    rows = 0;
    shardHash = createHash('sha256');
  };
  const seal = () => {
    if (fd == null) return;
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    const logical = { path: file, bytes, sha256: shardHash.digest('hex') };
    const archive = `${file}.gz`;
    const receiptPath = `${archive}.receipt.json`;
    const requestPath = `${file}.seal-request.json`;
    const expectedParent = { pid: process.pid, pgid: ownPgid() };
    writeExclusiveJson(requestPath, {
      projectRoot,
      file,
      archive,
      receiptPath,
      logical,
      rows,
      authority,
      storage,
      expectedParent,
    });
    if (sha256(fs.readFileSync(helperPath)) !== storage.helperSha256)
      throw new Error('Archive helper changed');
    const result = spawnSync(
      process.execPath,
      [helperPath, '--seal', requestPath],
      {
        shell: false,
        detached: false,
        timeout: limits.timeoutMs,
        maxBuffer: limits.maxBuffer,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (
      result.error ||
      result.status !== 0 ||
      result.signal ||
      !fs.existsSync(receiptPath)
    )
      throw new Error('Archive child failed; partial evidence retained');
    const receiptBytes = readBoundedFile(receiptPath, limits.maxBuffer);
    if (receiptBytes.length > limits.maxBuffer)
      throw new Error('Archive receipt byte bound exceeded');
    const receipt = JSON.parse(receiptBytes);
    if (
      receipt.schema !== 'tradejs-sealed-capture-shard/v1' ||
      receipt.status !== 'archived-not-run-accepted' ||
      !same(receipt.authority, authority) ||
      !same(receipt.logical, logical) ||
      receipt.rows !== rows ||
      receipt.helperSha256 !== storage.helperSha256 ||
      receipt.archiveChild?.ppid !== expectedParent.pid ||
      receipt.archiveChild?.pgid !== expectedParent.pgid ||
      receipt.physical.path !== archive ||
      receipt.physical.bytes > limits.maxArchiveBytes
    )
      throw new Error('Archive child receipt mismatch');
    shards.push({
      sequence: shards.length + 1,
      logical,
      physical: receipt.physical,
      rows,
      receipt: { path: receiptPath, sha256: sha256(receiptBytes) },
    });
    // Explicit opt-in grants apply only to the just-created, readback-verified plain file.
    // Production caller must separately authorize this archival/reclamation policy.
    if (storage.reclaimPlain) fs.unlinkSync(file);
  };
  return {
    file: prefix,
    append(record) {
      if (closed || failed) throw new Error('Storage sink closed/failed');
      try {
        const encoded = Buffer.from(canonicalJson(record) + '\n');
        if (encoded.length > limits.maxLineBytes + 1)
          throw new Error('JSON line byte bound exceeded');
        if (fd != null && bytes + encoded.length > limits.maxShardBytes) seal();
        if (fd == null) open();
        fs.writeFileSync(fd, encoded);
        shardHash.update(encoded);
        whole.update(encoded);
        bytes += encoded.length;
        rows++;
        count++;
        if (record.schema === 'tradejs-entry-inventory/v1') {
          if (
            !Number.isSafeInteger(record.timestamp) ||
            !record.symbol ||
            !record.signalId ||
            !same(
              Object.fromEntries(
                Object.keys(authority).map((key) => [key, record[key]]),
              ),
              authority,
            )
          )
            throw new Error('Inventory sidecar authority/timestamp mismatch');
          inventorySidecar ??= createShardedCaptureSink({
            projectRoot,
            outputPath: `${outputPath}.inventory`,
            authority,
            workerObservation,
            storage,
          });
          inventorySidecar.append({
            schema: 'tradejs-entry-inventory-timestamp/v1',
            signalId: record.signalId,
            symbol: record.symbol,
            timestamp: record.timestamp,
            sequence: count,
            disposition: record.disposition,
          });
        }
      } catch (error) {
        fail();
        throw error;
      }
    },
    close() {
      if (closed || failed) throw new Error('Storage sink closed/failed');
      closed = true;
      try {
        seal();
        let sidecar;
        if (inventorySidecar) {
          const inventory = inventorySidecar.close();
          const sidecarPath = `${prefix}.inventory.storage.json`;
          sidecar = {
            path: sidecarPath,
            sha256: sha256(readBoundedFile(sidecarPath, 16777216)),
            rows: inventory.rows,
            logicalSha256: inventory.logicalSha256,
          };
        }
        const manifest = {
          schema: 'tradejs-capture-storage-manifest/v1',
          status: 'worker-closed-not-run-accepted',
          authority,
          workerObservation,
          storage: { ...storage, ...limits },
          logicalSha256: whole.digest('hex'),
          rows: count,
          shards,
          ...(sidecar ? { inventorySidecar: sidecar } : {}),
          resources: {
            maxPendingArchives: 1,
            archiveChildDetached: false,
            wholePayloadsRetained: 0,
            accounting:
              'logical buffer bounds, not exact V8 RSS; sampled supervisor required',
          },
        };
        writeExclusiveJson(manifestPath, manifest);
        return manifest;
      } catch (error) {
        fail();
        throw error;
      }
    },
    abort() {
      failed = true;
      if (fd != null) {
        fs.closeSync(fd);
        fd = null;
      }
      inventorySidecar?.abort();
    },
  };
};

export const readStorageManifest = async function* ({
  projectRoot,
  descriptor,
  authority,
  expectedStorage,
  onDecode,
}) {
  const expectedResolvedStorage = {
    ...expectedStorage,
    ...storageLimits(expectedStorage),
  };
  const verifyExecutingHelper = () => {
    if (
      !/^[a-f0-9]{64}$/.test(expectedStorage.helperSha256 ?? '') ||
      sha256(readBoundedFile(helperPath, 1048576)) !==
        expectedStorage.helperSha256
    )
      throw new Error('Expected executing storage helper checksum mismatch');
  };
  verifyExecutingHelper();
  const manifestPath = boundPath(projectRoot, descriptor.path);
  if (
    manifestPath.endsWith('.storage.json') &&
    fs.existsSync(
      manifestPath.replace(/\.storage\.json$/, '.storage-failed.json'),
    )
  )
    throw new Error('Failed storage worker cannot be accepted');
  const manifestBytes = readBoundedFile(manifestPath, 16777216);
  if (
    manifestBytes.length > 16777216 ||
    sha256(manifestBytes) !== descriptor.sha256
  )
    throw new Error('Storage manifest checksum/byte bound mismatch');
  const manifest = JSON.parse(manifestBytes);
  if (
    manifest.schema !== 'tradejs-capture-storage-manifest/v1' ||
    manifest.status !== 'worker-closed-not-run-accepted' ||
    !same(manifest.authority, authority) ||
    !same(manifest.storage, expectedResolvedStorage)
  )
    throw new Error('Storage manifest authority mismatch');
  const limits = storageLimits(manifest.storage);
  if (
    !Array.isArray(manifest.shards) ||
    manifest.shards.length > limits.maxShards
  )
    throw new Error('Storage shard count bound exceeded');
  const hash = createHash('sha256');
  let rows = 0;
  const seen = new Set();
  for (const [i, shard] of manifest.shards.entries()) {
    const archive = boundPath(projectRoot, shard.physical.path);
    const receiptPath = boundPath(projectRoot, shard.receipt.path);
    if (
      seen.has(archive) ||
      shard.sequence !== i + 1 ||
      !positive(shard.logical.bytes) ||
      shard.logical.bytes > limits.maxShardBytes
    )
      throw new Error('Duplicate/invalid shard sequence');
    seen.add(archive);
    const receiptBytes = readBoundedFile(receiptPath, limits.maxBuffer);
    if (
      receiptBytes.length > limits.maxBuffer ||
      sha256(receiptBytes) !== shard.receipt.sha256
    )
      throw new Error('Shard receipt checksum mismatch');
    const receipt = JSON.parse(receiptBytes);
    if (
      receipt.schema !== 'tradejs-sealed-capture-shard/v1' ||
      receipt.status !== 'archived-not-run-accepted' ||
      !same(receipt.logical, shard.logical) ||
      !same(receipt.physical, shard.physical) ||
      !same(receipt.authority, authority) ||
      receipt.rows !== shard.rows ||
      receipt.helperSha256 !== manifest.storage.helperSha256
    )
      throw new Error('Shard receipt binding mismatch');
    let shardRows = 0;
    onDecode?.(archive);
    async function* decoded() {
      for await (const bytes of readArchiveBytes(archive, shard, limits)) {
        hash.update(bytes);
        yield bytes;
      }
    }
    for await (const line of scanCanonicalChunks(
      decoded(),
      limits.maxLineBytes,
    )) {
      rows++;
      shardRows++;
      yield { ...line, shardSequence: i + 1 };
    }
    if (shardRows !== shard.rows) throw new Error('Shard rows mismatch');
  }
  if (
    rows !== manifest.rows ||
    hash.digest('hex') !== manifest.logicalSha256 ||
    sha256(fs.readFileSync(manifestPath)) !== descriptor.sha256
  )
    throw new Error('Storage logical stream/input mismatch');
  verifyExecutingHelper();
};

// Exact disk index with caller-provided bounded JSON values. One bounded sort
// run and <=16 merge heads live in memory; generic values may contain payloads.
export const createDiskIdentityIndex = ({
  projectRoot,
  directory,
  maxSortBytes = 16777216,
  maxRecordBytes = 16384,
  maxRows = 1000000,
  maxBytes = 268435456,
  maxDiskBytes = 2147483648,
  maxRuns = 4096,
  fanIn = 16,
}) => {
  if (
    ![
      maxSortBytes,
      maxRecordBytes,
      maxRows,
      maxBytes,
      maxDiskBytes,
      maxRuns,
      fanIn,
    ].every(positive) ||
    maxRecordBytes > maxSortBytes ||
    maxRecordBytes > 16384 ||
    maxSortBytes > 16777216 ||
    fanIn < 2 ||
    fanIn > 16 ||
    maxRows > 10000000 ||
    maxBytes > 8589934592 ||
    maxDiskBytes > 8589934592 ||
    maxRuns > 65536
  )
    throw new Error('Invalid disk index bounds');
  const dir = boundPath(projectRoot, directory, false);
  fs.mkdirSync(dir);
  let buffered = [];
  let bufferedBytes = 0;
  let totalBytes = 0;
  let totalRows = 0;
  let peakBytes = 0;
  let peakBufferedRecords = 0;
  let runNumber = 0;
  let diskBytes = 0;
  let runs = [];
  let closed = false;
  const compare = (a, b) =>
    a.digest < b.digest
      ? -1
      : a.digest > b.digest
        ? 1
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0;
  const diskWrite = (fd, bytes) => {
    const size = Buffer.byteLength(bytes);
    if (diskBytes + size > maxDiskBytes)
      throw new Error('Disk index physical byte bound exceeded');
    fs.writeFileSync(fd, bytes);
    diskBytes += size;
  };
  const writeRows = (file, rows) => {
    const fd = fs.openSync(file, 'wx');
    try {
      for (const row of rows) diskWrite(fd, canonicalJson(row) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const flush = () => {
    if (!buffered.length) return;
    if (runNumber >= maxRuns) throw new Error('Disk index run bound exceeded');
    buffered.sort(compare);
    const file = path.join(dir, `run-${runNumber++}.jsonl`);
    writeRows(file, buffered);
    runs.push(file);
    buffered = [];
    bufferedBytes = 0;
  };
  const merge = async (group, output) => {
    const readers = group.map((file) =>
      scanCanonicalChunks(
        fs.createReadStream(file, { highWaterMark: 65536 }),
        maxRecordBytes,
      ),
    );
    const heads = await Promise.all(readers.map((reader) => reader.next()));
    const fd = fs.openSync(output, 'wx');
    let prior;
    try {
      while (true) {
        let selected = -1;
        for (let i = 0; i < heads.length; i++)
          if (
            !heads[i].done &&
            (selected < 0 ||
              compare(heads[i].value.row, heads[selected].value.row) < 0)
          )
            selected = i;
        if (selected < 0) break;
        const row = heads[selected].value.row;
        if (prior?.digest === row.digest)
          throw new Error(
            prior.key === row.key
              ? 'Duplicate disk identity'
              : 'Digest collision',
          );
        diskWrite(fd, canonicalJson(row) + '\n');
        prior = row;
        heads[selected] = await readers[selected].next();
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
      await Promise.all(readers.map((reader) => reader.return()));
    }
  };
  return {
    append(key, value) {
      if (
        closed ||
        typeof key !== 'string' ||
        !key ||
        key.includes('\r') ||
        key.includes('\n')
      )
        throw new Error('Invalid disk identity/closed index');
      const row = { digest: sha256(key), key, value };
      const bytes = Buffer.byteLength(canonicalJson(row)) + 1;
      if (
        bytes > maxRecordBytes ||
        totalRows >= maxRows ||
        totalBytes + bytes > maxBytes
      )
        throw new Error('Disk index resource bound exceeded');
      if (bufferedBytes + bytes > maxSortBytes) flush();
      buffered.push(row);
      peakBufferedRecords = Math.max(peakBufferedRecords, buffered.length);
      bufferedBytes += bytes;
      totalBytes += bytes;
      totalRows++;
      peakBytes = Math.max(peakBytes, bufferedBytes);
    },
    async close() {
      if (closed) throw new Error('Disk index already closed');
      closed = true;
      flush();
      // A single run still goes through the exact duplicate/collision validator.
      if (!runs.length) {
        const file = path.join(dir, `run-${runNumber++}.jsonl`);
        writeRows(file, []);
        runs.push(file);
      }
      let generation = 0;
      do {
        const next = [];
        for (let i = 0; i < runs.length; i += fanIn) {
          const file = path.join(dir, `merge-${generation}-${i}.jsonl`);
          await merge(runs.slice(i, i + fanIn), file);
          next.push(file);
        }
        runs = next;
        generation++;
      } while (runs.length > 1);
      const dataFile = runs[0];
      const searchFile = path.join(dir, 'search.bin');
      const markFile = path.join(dir, 'marks.bin');
      const fd = fs.openSync(searchFile, 'wx');
      const marks = fs.openSync(markFile, 'wx+');
      let count = 0;
      try {
        for await (const line of scanCanonicalChunks(
          fs.createReadStream(dataFile, { highWaterMark: 65536 }),
          maxRecordBytes,
        )) {
          const fixed = Buffer.alloc(76);
          Buffer.from(line.row.digest, 'hex').copy(fixed);
          fixed.writeBigUInt64BE(BigInt(line.offset), 32);
          fixed.writeUInt32BE(line.length, 40);
          Buffer.from(line.sha256, 'hex').copy(fixed, 44);
          diskWrite(fd, fixed);
          count++;
        }
        if (diskBytes + count > maxDiskBytes)
          throw new Error('Disk index physical byte bound exceeded');
        fs.ftruncateSync(marks, count);
        diskBytes += count;
        fs.fsyncSync(marks);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
        fs.closeSync(marks);
      }
      const inputHash = await boundedHash(dataFile, maxBytes);
      const searchHash = await boundedHash(
        searchFile,
        Math.max(1, maxRows * 76),
      );
      const lookup = (key, mark = false) => {
        const digest = Buffer.from(sha256(key), 'hex');
        const search = fs.openSync(searchFile, 'r');
        const data = fs.openSync(dataFile, 'r');
        const markFd = fs.openSync(markFile, 'r+');
        try {
          let lo = 0;
          let hi = count - 1;
          const fixed = Buffer.alloc(76);
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (fs.readSync(search, fixed, 0, 76, mid * 76) !== 76)
              throw new Error('Disk search index truncated');
            const comparison = Buffer.compare(fixed.subarray(0, 32), digest);
            if (comparison < 0) {
              lo = mid + 1;
              continue;
            }
            if (comparison > 0) {
              hi = mid - 1;
              continue;
            }
            const offset = Number(fixed.readBigUInt64BE(32));
            const length = fixed.readUInt32BE(40);
            if (
              !Number.isSafeInteger(offset) ||
              length > maxRecordBytes ||
              length <= 1
            )
              throw new Error('Disk reference bounds');
            const bytes = Buffer.alloc(length);
            if (
              fs.readSync(data, bytes, 0, length, offset) !== length ||
              bytes.at(-1) !== 10 ||
              sha256(bytes) !== fixed.subarray(44).toString('hex')
            )
              throw new Error('Disk reference mismatch');
            const text = new TextDecoder('utf-8', { fatal: true }).decode(
              bytes.subarray(0, -1),
            );
            const row = JSON.parse(text);
            if (
              canonicalJson(row) !== text ||
              row.digest !== digest.toString('hex') ||
              row.key !== key
            )
              throw new Error('Disk index identity mismatch');
            if (mark) {
              const bit = Buffer.alloc(1);
              fs.readSync(markFd, bit, 0, 1, mid);
              if (bit[0]) throw new Error('Duplicate matched identity');
              fs.writeSync(markFd, Buffer.from([1]), 0, 1, mid);
            }
            return row.value;
          }
          return null;
        } finally {
          fs.closeSync(search);
          fs.closeSync(data);
          fs.closeSync(markFd);
        }
      };
      return {
        get: lookup,
        rows: count,
        entries: () =>
          scanCanonicalChunks(
            fs.createReadStream(dataFile, { highWaterMark: 65536 }),
            maxRecordBytes,
          ),
        async verify() {
          if (
            !same(inputHash, await boundedHash(dataFile, maxBytes)) ||
            !same(
              searchHash,
              await boundedHash(searchFile, Math.max(1, maxRows * 76)),
            )
          )
            throw new Error('Disk index changed');
        },
        resources: {
          maxSortBytes,
          peakLogicalSortBytes: peakBytes,
          maxRecordBytes,
          maxMergeHeads: fanIn,
          maxRuns,
          maxDiskBytes,
          accountedDiskBytes: diskBytes,
          lookupFileHandles: 3,
          peakBufferedRecords,
          indexValuePolicy:
            'caller-provided bounded JSON; payload-free not guaranteed',
          indexRows: count,
          indexLogicalBytes: totalBytes,
          accounting:
            'logical JSON/sort bytes, not exact V8 heap/RSS; sampler required',
        },
      };
    },
  };
};

export const readBoundedReference = (file, entry, maxLineBytes) => {
  if (
    !Number.isSafeInteger(entry.offset) ||
    entry.offset < 0 ||
    !positive(entry.length) ||
    entry.length > maxLineBytes + 1
  )
    throw new Error('Invalid row reference bounds');
  const fd = fs.openSync(file, 'r');
  try {
    const prior = Buffer.alloc(1);
    if (
      entry.offset &&
      (fs.readSync(fd, prior, 0, 1, entry.offset - 1) !== 1 || prior[0] !== 10)
    )
      throw new Error('Row offset not LF boundary');
    const bytes = Buffer.alloc(entry.length);
    if (
      fs.readSync(fd, bytes, 0, bytes.length, entry.offset) !== bytes.length ||
      bytes.at(-1) !== 10 ||
      bytes.includes(13) ||
      bytes.subarray(0, -1).includes(10) ||
      sha256(bytes) !== entry.sha256
    )
      throw new Error('Row reference checksum mismatch');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1)),
    );
  } finally {
    fs.closeSync(fd);
  }
};

// Ordered compressed spill runs keep the native source sequence without a
// full joined plain file. This is bounded external sorting, not gate ranking.
export const createOrderedShardWriter = ({
  projectRoot,
  outputPath,
  authority,
  workerObservation,
  storage,
  maxSortBytes = 16777216,
  fanIn = 16,
  maxRuns = 4096,
}) => {
  const limits = storageLimits(storage);
  if (
    !positive(maxSortBytes) ||
    maxSortBytes > 16777216 ||
    !positive(fanIn) ||
    fanIn < 2 ||
    fanIn > 16 ||
    !positive(maxRuns) ||
    maxRuns > 65536
  )
    throw new Error('Invalid ordered spill bounds');
  let buffered = [];
  let bytes = 0;
  let peakBytes = 0;
  let peakBufferedPayloadRows = 0;
  let peakMergeHeadRows = 0;
  let runs = [];
  let n = 0;
  let closed = false;
  const sinkAt = (prefix) =>
    createShardedCaptureSink({
      projectRoot,
      outputPath: prefix,
      authority,
      workerObservation,
      storage,
    });
  const descriptorAt = (prefix) => {
    const file = boundPath(projectRoot, `${prefix}.storage.json`);
    return { path: file, sha256: sha256(readBoundedFile(file, 16777216)) };
  };
  const flush = () => {
    if (!buffered.length) return;
    if (n >= maxRuns) throw new Error('Ordered run bound exceeded');
    buffered.sort((a, b) => a.sequence - b.sequence);
    const prefix = `${outputPath}.sort${n++}`;
    const sink = sinkAt(prefix);
    try {
      for (const row of buffered) sink.append(row);
      sink.close();
    } catch (error) {
      sink.abort();
      throw error;
    }
    runs.push(descriptorAt(prefix));
    buffered = [];
    bytes = 0;
  };
  const merge = async (group, prefix, final) => {
    const readers = group.map((descriptor) =>
      readStorageManifest({
        projectRoot,
        descriptor,
        authority,
        expectedStorage: storage,
      }),
    );
    const heads = await Promise.all(readers.map((r) => r.next()));
    peakMergeHeadRows = Math.max(
      peakMergeHeadRows,
      heads.filter((head) => !head.done).length,
    );
    const sink = sinkAt(prefix);
    let prior = -1;
    try {
      while (true) {
        let selected = -1;
        for (let i = 0; i < heads.length; i++)
          if (
            !heads[i].done &&
            (selected < 0 ||
              heads[i].value.row.sequence < heads[selected].value.row.sequence)
          )
            selected = i;
        if (selected < 0) break;
        const entry = heads[selected].value.row;
        if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= prior)
          throw new Error('Duplicate/nonascending native sequence');
        sink.append(final ? entry.row : entry);
        prior = entry.sequence;
        heads[selected] = await readers[selected].next();
      }
      const manifest = sink.close();
      return { descriptor: descriptorAt(prefix), manifest };
    } catch (error) {
      sink.abort();
      throw error;
    } finally {
      await Promise.all(readers.map((r) => r.return()));
    }
  };
  return {
    append(sequence, row) {
      if (closed || !Number.isSafeInteger(sequence) || sequence < 0)
        throw new Error('Invalid native sequence/closed writer');
      const entry = { sequence, row };
      const size = Buffer.byteLength(canonicalJson(entry)) + 1;
      if (size > limits.maxLineBytes + 1 || size > maxSortBytes)
        throw new Error('Ordered row byte bound exceeded');
      if (bytes + size > maxSortBytes) flush();
      buffered.push(entry);
      peakBufferedPayloadRows = Math.max(
        peakBufferedPayloadRows,
        buffered.length,
      );
      bytes += size;
      peakBytes = Math.max(peakBytes, bytes);
    },
    async close() {
      if (closed) throw new Error('Ordered writer already closed');
      closed = true;
      flush();
      if (!runs.length) throw new Error('No completed joined labels');
      let generation = 0;
      while (runs.length > fanIn) {
        const next = [];
        for (let i = 0; i < runs.length; i += fanIn)
          next.push(
            (
              await merge(
                runs.slice(i, i + fanIn),
                `${outputPath}.merge${generation}-${i}`,
                false,
              )
            ).descriptor,
          );
        runs = next;
        generation++;
      }
      const result = await merge(runs, outputPath, true);
      return {
        ...result,
        resources: {
          peakLogicalSortBytes: peakBytes,
          peakBufferedPayloadRows,
          peakMergeHeadRows,
          payloadBuffering:
            'complete payload rows in bounded ordered sort and merge heads',
          maxSortBytes,
          maxMergeHeads: fanIn,
          maxRuns,
          compressionStaging:
            'one64MiB shard per active merge sink; compressed spills retained, no ungranted cleanup',
          nativeSequencePreserved: true,
          accounting: 'not exact V8 heap/RSS',
        },
      };
    },
  };
};

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 4 || process.argv[2] !== '--seal')
    throw new Error(
      'Usage: decision-capture-storage.mjs --seal <own-request.json>',
    );
  const bytes = readBoundedFile(process.argv[3], 65536);
  if (bytes.length > 65536) throw new Error('Seal request bound exceeded');
  await sealShard(JSON.parse(bytes));
}
