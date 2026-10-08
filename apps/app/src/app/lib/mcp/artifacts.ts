import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  verifyRuntimeEvidenceBundle,
  verifyRuntimeFeedbackReplayBundle,
} from '@tradejs/node/diagnostics';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  isMcpRecord,
  mcpId,
  mcpProjectRoot,
  readMcpDeployments,
} from '@tradejs/node/mcp';

interface CatalogEntry {
  id: string;
  userName: string;
  deploymentId: string;
  kind: 'runtime-evidence' | 'runtime-feedback-replay';
  bundleDir: string;
  payloadPath: string;
  sha256: string;
  bytes: number;
  manifest: Record<string, unknown>;
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

const verifyEntry = async (
  bundleDir: string,
  userName: string,
  allowed: Set<string>,
): Promise<CatalogEntry> => {
  const manifestPath = await confinedPath(
    path.join(bundleDir, 'manifest.json'),
  );
  const manifestStat = await stat(manifestPath);
  if (manifestStat.size > 256 * 1024) throw new Error('Manifest too large');
  const header: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (
    !isMcpRecord(header) ||
    header.userName !== userName ||
    typeof header.deploymentId !== 'string' ||
    !allowed.has(header.deploymentId)
  )
    throw new Error('Artifact unavailable for this user');
  if (header.reportType === 'runtime-evidence') {
    await checkPayload(path.join(bundleDir, 'runtime-evidence.json'));
    const verified = await verifyRuntimeEvidenceBundle(bundleDir);
    if (verified.artifact.userName !== userName)
      throw new Error('Artifact unavailable for this user');
    return {
      id: mcpId(
        `${verified.manifest.artifactId}:${verified.manifest.payload.sha256}`,
      ),
      userName,
      deploymentId: verified.manifest.deploymentId,
      kind: 'runtime-evidence',
      bundleDir,
      payloadPath: verified.payloadPath,
      sha256: verified.manifest.payload.sha256,
      bytes: verified.manifest.payload.bytes,
      manifest: verified.manifest,
    };
  }
  if (header.reportType === 'runtime-feedback-replay') {
    await checkPayload(path.join(bundleDir, 'replay-runtime-evidence.json'));
    await checkPayload(path.join(bundleDir, 'replay.log'));
    const verified = await verifyRuntimeFeedbackReplayBundle(bundleDir);
    return {
      id: mcpId(
        `${verified.manifest.artifactId}:${verified.manifest.payloads.replayEvidence.sha256}`,
      ),
      userName,
      deploymentId: verified.manifest.deploymentId,
      kind: 'runtime-feedback-replay',
      bundleDir,
      payloadPath: verified.replayEvidencePath,
      sha256: verified.manifest.payloads.replayEvidence.sha256,
      bytes: verified.manifest.payloads.replayEvidence.bytes,
      manifest: verified.manifest,
    };
  }
  throw new Error('Unsupported artifact');
};

export const listMcpArtifacts = async (userName: string) => {
  const { deployments } = await readMcpDeployments(userName);
  const allowed = new Set(deployments.map((row) => row.id));
  const pending = [
    'runtime-evidence',
    'runtime-feedback',
    `mcp/${mcpId(userName)}`,
  ].map((dir) => ({ dir: path.join(dataRoot(), dir), depth: 0 }));
  const items = [];
  let visited = 0;
  let invalidBundles = 0;
  while (pending.length && visited < 2000 && items.length < 100) {
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
        const artifact = await verifyEntry(current.dir, userName, allowed);
        await mcpStorage.put(storageKey(userName, artifact.id), artifact, 3600);
        items.push({
          id: artifact.id,
          kind: artifact.kind,
          deploymentId: artifact.deploymentId,
          sha256: artifact.sha256,
          bytes: artifact.bytes,
          manifest: artifact.manifest,
        });
      } catch {
        invalidBundles++;
      }
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
  return {
    items,
    observedAt: Date.now(),
    source: 'verified_local_bundles',
    truncated: pending.length > 0,
    invalidOrInaccessibleBundles: invalidBundles,
    note: 'Only verified, user-owned bundles available on this host are included.',
  };
};

export const resolveMcpArtifact = async (userName: string, id: string) => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid artifact id');
  const stored = await mcpStorage.get<CatalogEntry>(storageKey(userName, id));
  if (!stored || stored.userName !== userName)
    throw new Error('Artifact not found; refresh diagnostics_list_reports');
  const { deployments } = await readMcpDeployments(userName);
  const verified = await verifyEntry(
    stored.bundleDir,
    userName,
    new Set(deployments.map((row) => row.id)),
  );
  if (verified.id !== id) throw new Error('Artifact changed since listing');
  return verified;
};

export const readMcpArtifactChunk = async (
  userName: string,
  id: string,
  offset: number,
  length: number,
) => {
  const artifact = await resolveMcpArtifact(userName, id);
  const handle = await open(await confinedPath(artifact.payloadPath), 'r');
  try {
    const buffer = Buffer.alloc(
      Math.min(length, Math.max(0, artifact.bytes - offset)),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    return {
      id,
      offset,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      encoding: 'base64',
      data: buffer.subarray(0, bytesRead).toString('base64'),
      nextOffset:
        offset + bytesRead < artifact.bytes ? offset + bytesRead : null,
    };
  } finally {
    await handle.close();
  }
};

export const readMcpDiagnosticReport = async (userName: string, id: string) => {
  const artifact = await resolveMcpArtifact(userName, id);
  const payload = JSON.parse(await readFile(artifact.payloadPath, 'utf8'));
  // Large reports stay available through artifact_get with original checksums.
  return {
    id,
    manifest: artifact.manifest,
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
