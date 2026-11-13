import type { BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  verifyRuntimeEvidenceBundle,
  verifyRuntimeFeedbackReplayBundle,
} from '@tradejs/node/diagnostics';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  isMcpRecord,
  mcpArtifactLocationId,
  mcpId,
  mcpProjectRoot,
  readMcpDeployments,
  redactMcpJobLog,
} from '@tradejs/node/mcp';

interface CatalogEntry {
  id: string;
  userName: string;
  deploymentId: string;
  accountId: string;
  deploymentCompositionId: string;
  kind: 'runtime-evidence' | 'runtime-feedback-replay';
  bundleDir: string;
  payloadPath: string;
  sha256: string;
  bytes: number;
  manifest: Record<string, unknown> & {
    artifactId: string;
    window: { startTime: number; endTime: number };
  };
  fingerprints: FileFingerprint[];
}
const storageKey = (userName: string, id: string) =>
  `artifacts:${mcpId(userName)}:${id}`;
const MAX_CATALOG_PAYLOAD_BYTES = 64 * 1024 * 1024;
const checkPayload = async (file: string) => {
  const resolved = await confinedPath(file);
  if ((await stat(resolved)).size > MAX_CATALOG_PAYLOAD_BYTES)
    throw new Error('Artifact exceeds catalog size limit');
  return resolved;
};
const dataRoot = () => path.join(mcpProjectRoot(), 'data');

const confinedPath = async (file: string) => {
  const [root, resolved] = await Promise.all([
    realpath(dataRoot()),
    realpath(file),
  ]);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error('Artifact outside data root');
  return resolved;
};

const readHeader = async (bundleDir: string) => {
  const file = await confinedPath(path.join(bundleDir, 'manifest.json'));
  if ((await stat(file)).size > 256 * 1024)
    throw new Error('Manifest too large');
  const header: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (
    !isMcpRecord(header) ||
    typeof header.userName !== 'string' ||
    typeof header.deploymentId !== 'string' ||
    (header.reportType !== 'runtime-evidence' &&
      header.reportType !== 'runtime-feedback-replay') ||
    !isMcpRecord(header.window) ||
    typeof header.window.startTime !== 'number' ||
    typeof header.window.endTime !== 'number' ||
    !Number.isFinite(header.window.startTime) ||
    !Number.isFinite(header.window.endTime)
  )
    throw new Error('Invalid artifact manifest');
  return {
    userName: header.userName,
    deploymentId: header.deploymentId,
    kind: header.reportType,
    startTime: header.window.startTime,
    endTime: header.window.endTime,
  } as const;
};

type FileFingerprint = { path: string; identity: string };
const fileIdentity = ({ dev, ino, size, mtimeNs, ctimeNs }: BigIntStats) =>
  [dev, ino, size, mtimeNs, ctimeNs].join(':');

const bundleFingerprints = (bundleDir: string, kind: CatalogEntry['kind']) =>
  Promise.all(
    [
      'manifest.json',
      '.complete',
      ...(kind === 'runtime-evidence'
        ? ['runtime-evidence.json']
        : ['replay-runtime-evidence.json', 'replay.log']),
    ].map(async (name): Promise<FileFingerprint> => {
      const file = await checkPayload(path.join(bundleDir, name));
      const info = await stat(file, { bigint: true });
      if (!info.isFile()) throw new Error('Invalid artifact file');
      return { path: file, identity: fileIdentity(info) };
    }),
  );

const sameFingerprints = (a: FileFingerprint[], b: FileFingerprint[]) =>
  a.length === b.length &&
  a.every(
    (file, index) =>
      file.path === b[index].path && file.identity === b[index].identity,
  );

const verifyEntry = async (
  bundleDir: string,
  userName: string,
  allowed: Set<string>,
  header?: Awaited<ReturnType<typeof readHeader>>,
): Promise<CatalogEntry> => {
  const {
    kind,
    deploymentId,
    userName: owner,
    startTime,
    endTime,
  } = header ?? (await readHeader(bundleDir));
  if (owner !== userName || !allowed.has(deploymentId))
    throw new Error('Artifact unavailable for this user');

  const fingerprints = await bundleFingerprints(bundleDir, kind);
  const verified =
    kind === 'runtime-evidence'
      ? await verifyRuntimeEvidenceBundle(bundleDir).then((bundle) => ({
          manifest: bundle.manifest,
          descriptor: bundle.manifest.payload,
          payloadPath: bundle.payloadPath,
          payload: bundle.artifact,
        }))
      : await verifyRuntimeFeedbackReplayBundle(bundleDir).then((bundle) => ({
          manifest: bundle.manifest,
          descriptor: bundle.manifest.payloads.replayEvidence,
          payloadPath: bundle.replayEvidencePath,
          payload: bundle.replayEvidence,
        }));
  const { manifest, descriptor, payloadPath, payload } = verified;
  const deployment = payload.deployment;
  if (
    manifest.userName !== userName ||
    manifest.deploymentId !== deploymentId ||
    payload.userName !== userName ||
    !isMcpRecord(deployment) ||
    typeof deployment.accountId !== 'string' ||
    typeof deployment.deploymentCompositionId !== 'string'
  )
    throw new Error('Artifact unavailable for this user');
  if (
    manifest.window.startTime !== startTime ||
    manifest.window.endTime !== endTime ||
    !sameFingerprints(fingerprints, await bundleFingerprints(bundleDir, kind))
  )
    throw new Error('Artifact changed during verification');
  return {
    id: mcpId(`${manifest.artifactId}:${descriptor.sha256}`),
    userName,
    deploymentId,
    accountId: deployment.accountId,
    deploymentCompositionId: deployment.deploymentCompositionId,
    kind,
    bundleDir,
    payloadPath,
    sha256: descriptor.sha256,
    bytes: descriptor.bytes,
    manifest,
    fingerprints,
  };
};

export interface McpArtifactListOptions {
  deploymentId?: string;
  kind?: CatalogEntry['kind'];
  deploymentCompositionId?: string;
  accountId?: string;
  offset?: number;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export const listMcpArtifacts = async (
  userName: string,
  options: McpArtifactListOptions = {},
) => {
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Invalid artifact list pagination');
  if (
    (options.startTime !== undefined &&
      !Number.isSafeInteger(options.startTime)) ||
    (options.endTime !== undefined && !Number.isSafeInteger(options.endTime)) ||
    (options.startTime !== undefined &&
      options.endTime !== undefined &&
      options.startTime >= options.endTime)
  )
    throw new Error('Invalid artifact window');
  const { deployments } = await readMcpDeployments(userName);
  const allowed = new Set(deployments.map((row) => row.id));
  const pending = [
    'runtime-evidence',
    'runtime-feedback',
    `mcp/${mcpId(userName)}`,
  ].map((dir) => ({ dir: path.join(dataRoot(), dir), depth: 0 }));
  const items = [];
  const seen = new Set<string>();
  let visited = 0;
  let invalidBundles = 0;
  while (pending.length && visited < 2000) {
    const current = pending.shift()!;
    visited++;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.name === '.complete' && entry.isFile())) {
      try {
        const header = await readHeader(current.dir);
        if (
          (options.deploymentId &&
            header.deploymentId !== options.deploymentId) ||
          (options.kind && header.kind !== options.kind) ||
          (options.startTime !== undefined &&
            header.endTime <= options.startTime) ||
          (options.endTime !== undefined && header.startTime >= options.endTime)
        )
          continue;
        const artifact = await verifyEntry(
          current.dir,
          userName,
          allowed,
          header,
        );
        if (
          (options.deploymentCompositionId &&
            artifact.deploymentCompositionId !==
              options.deploymentCompositionId) ||
          (options.accountId && artifact.accountId !== options.accountId)
        )
          continue;
        const { window } = artifact.manifest;
        if (seen.has(artifact.id)) continue;
        await mcpStorage.put(storageKey(userName, artifact.id), artifact, 3600);
        seen.add(artifact.id);
        items.push({
          id: artifact.id,
          kind: artifact.kind,
          deploymentId: artifact.deploymentId,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          window,
          artifactId: artifact.manifest.artifactId,
          accountId: artifact.accountId,
          deploymentCompositionId: artifact.deploymentCompositionId,
          runtimeEvidence: artifact.manifest.runtimeEvidence,
        });
      } catch {
        invalidBundles++;
      }
      continue;
    }
    if (current.depth < 12)
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink())
          pending.push({
            dir: path.join(current.dir, entry.name),
            depth: current.depth + 1,
          });
      }
  }
  items.sort(
    (left, right) =>
      right.window.endTime - left.window.endTime ||
      left.id.localeCompare(right.id),
  );
  const page = items.slice(offset, offset + limit);
  const nextOffset =
    offset + page.length < items.length ? offset + page.length : null;
  return {
    items: page,
    offset,
    nextOffset,
    observedAt: Date.now(),
    source: 'verified_local_bundles',
    truncated: pending.length > 0 || nextOffset != null,
    scanTruncated: pending.length > 0,
    invalidOrInaccessibleBundles: invalidBundles,
    order: 'window.endTime_desc_id_asc',
    coverage: {
      retentionStartTime: null,
      completeness: 'host_local_verified_bundles_only',
    },
    note: 'Only verified, user-owned bundles available on this host are included. Excluded bundle counts combine inaccessible and invalid data; reasons and paths are withheld to protect other users. Missing bundles do not prove no activity.',
  };
};

export const resolveMcpArtifact = async (userName: string, id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid artifact id');
  const key = storageKey(userName, id);
  const stored = await mcpStorage.get<CatalogEntry>(key);
  const bundleDir =
    stored?.userName === userName
      ? stored.bundleDir
      : await mcpStorage.get<string>(mcpArtifactLocationId(userName, id));
  if (!bundleDir)
    throw new Error('Artifact not found; refresh diagnostics_list_reports');

  const { deployments } = await readMcpDeployments(userName);
  const allowed = new Set(deployments.map((row) => row.id));
  if (stored?.userName === userName && stored.fingerprints) {
    if (!allowed.has(stored.deploymentId))
      throw new Error('Artifact unavailable for this user');
    if (
      sameFingerprints(
        stored.fingerprints,
        await bundleFingerprints(bundleDir, stored.kind),
      )
    )
      return stored;
  }
  const verified = await verifyEntry(bundleDir, userName, allowed);
  if (verified.id !== id) throw new Error('Artifact changed since listing');
  await mcpStorage.put(key, verified, 3600);
  return verified;
};

type ArtifactFile = 'payload' | 'manifest.json' | '.complete' | 'replay.log';

const artifactFile = async (artifact: CatalogEntry, file: ArtifactFile) => {
  const target =
    file === 'payload'
      ? artifact.payloadPath
      : path.join(artifact.bundleDir, file);
  if (
    !['payload', 'manifest.json', '.complete', 'replay.log'].includes(file) ||
    (file === 'replay.log' && artifact.kind !== 'runtime-feedback-replay')
  )
    throw new Error('Invalid artifact file');
  const resolved = await checkPayload(target);
  if (file === 'payload')
    return {
      path: resolved,
      file,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    };
  const bytes = await readFile(resolved);
  // Log files are original bundle bytes. Refuse export if credential redaction
  // would be required; never silently change bytes advertised for verification.
  if (
    file === 'replay.log' &&
    bytes
      .toString('utf8')
      .split('\n')
      .some(
        (line) =>
          (line.length <= 1000 && redactMcpJobLog(line) !== line) ||
          line.length > 1000,
      )
  )
    throw new Error(
      'Invalid artifact file: log requires redaction; use job_get_logs',
    );
  return {
    path: resolved,
    file,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};

export const readMcpArtifactChunk = async (
  userName: string,
  id: string,
  offset: number,
  length: number,
  file: ArtifactFile = 'payload',
) => {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1
  )
    throw new Error('Invalid artifact chunk range');
  const artifact = await resolveMcpArtifact(userName, id);
  const selected = await artifactFile(artifact, file);
  if (offset > selected.bytes) throw new Error('Invalid artifact chunk offset');
  const handle = await open(selected.path, 'r');
  try {
    const fingerprint = artifact.fingerprints.find(
      (row) => row.path === selected.path,
    );
    if (
      !fingerprint ||
      fingerprint.identity !== fileIdentity(await handle.stat({ bigint: true }))
    )
      throw new Error('Artifact changed during download');
    const buffer = Buffer.alloc(
      Math.min(length, Math.max(0, selected.bytes - offset)),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (
      bytesRead !== buffer.length ||
      fingerprint.identity !== fileIdentity(await handle.stat({ bigint: true }))
    )
      throw new Error('Artifact changed during download');
    return {
      id,
      offset,
      file,
      bytes: selected.bytes,
      sha256: selected.sha256,
      encoding: 'base64',
      data: buffer.subarray(0, bytesRead).toString('base64'),
      nextOffset:
        offset + bytesRead < selected.bytes ? offset + bytesRead : null,
    };
  } finally {
    await handle.close();
  }
};

export const readMcpDiagnosticReport = async (userName: string, id: string) => {
  const artifact = await resolveMcpArtifact(userName, id);
  const payload = JSON.parse(await readFile(artifact.payloadPath, 'utf8'));
  const files = [];
  for (const file of [
    'payload',
    'manifest.json',
    '.complete',
    ...(artifact.kind === 'runtime-feedback-replay' ? ['replay.log'] : []),
  ] as ArtifactFile[]) {
    try {
      const { path: _path, ...descriptor } = await artifactFile(artifact, file);
      files.push({ ...descriptor, available: true });
    } catch {
      files.push({
        file,
        available: false,
        reason: 'file_unavailable_or_requires_redaction',
      });
    }
  }
  // Large reports stay available through artifact_get with original checksums.
  return {
    id,
    manifest: artifact.manifest,
    files,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    ...(artifact.bytes <= 96000
      ? { report: payload }
      : {
          summary: {
            reportType: payload.reportType,
            window: payload.window,
            deployment: payload.deployment,
            comparison: payload.comparison,
            counts: payload.counts,
          },
          fullReport: 'Use artifact_get to read the complete original payload.',
        }),
  };
};
