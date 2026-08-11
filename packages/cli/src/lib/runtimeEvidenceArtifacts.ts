import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RUNTIME_EVIDENCE_MANIFEST_FILE = 'manifest.json';
export const RUNTIME_EVIDENCE_PAYLOAD_FILE = 'runtime-evidence.json';
export const RUNTIME_EVIDENCE_COMPLETE_FILE = '.complete';

export type RuntimeEvidenceArtifactManifest = {
  schemaVersion: 1;
  artifactId: string;
  reportType: 'runtime-evidence';
  deploymentId: string;
  userName: string;
  createdAt: number;
  window: {
    startTime: number;
    endTime: number;
  };
  payload: {
    file: typeof RUNTIME_EVIDENCE_PAYLOAD_FILE;
    sha256: string;
    bytes: number;
  };
  counts: Record<string, number>;
  lineageKeys: string[];
};

export type VerifiedRuntimeEvidenceBundle = {
  bundleDir: string;
  manifestPath: string;
  payloadPath: string;
  manifest: RuntimeEvidenceArtifactManifest;
  artifact: Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

const runtimeEvidenceIdentitySha256 = (artifact: Record<string, unknown>) => {
  const identityArtifact = { ...artifact };
  delete identityArtifact.generatedAt;
  const runtime = asRecord(identityArtifact.runtime);
  if (runtime) {
    const identityRuntime = { ...runtime };
    delete identityRuntime.generatedAt;
    identityArtifact.runtime = identityRuntime;
  }
  return sha256(JSON.stringify(identityArtifact));
};

const isExistingDestinationError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
};

const safeSegment = (value: string, fallback: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized && normalized !== '.' && normalized !== '..'
    ? normalized
    : fallback;
};

const compactTimestamp = (timestamp: number) =>
  new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.000Z$/, 'Z');

const dateParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
};

const assertFiniteTimestamp = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid runtime evidence ${label}`);
  }
  return value;
};

const parseManifest = (value: unknown): RuntimeEvidenceArtifactManifest => {
  const manifest = asRecord(value);
  const window = asRecord(manifest?.window);
  const payload = asRecord(manifest?.payload);
  const counts = asRecord(manifest?.counts);

  if (
    manifest?.schemaVersion !== 1 ||
    manifest.reportType !== 'runtime-evidence' ||
    typeof manifest.artifactId !== 'string' ||
    typeof manifest.deploymentId !== 'string' ||
    typeof manifest.userName !== 'string' ||
    typeof manifest.createdAt !== 'number' ||
    payload?.file !== RUNTIME_EVIDENCE_PAYLOAD_FILE ||
    typeof payload.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(payload.sha256) ||
    typeof payload.bytes !== 'number' ||
    !Array.isArray(manifest.lineageKeys)
  ) {
    throw new Error('Invalid runtime evidence manifest');
  }

  return {
    schemaVersion: 1,
    artifactId: manifest.artifactId,
    reportType: 'runtime-evidence',
    deploymentId: manifest.deploymentId,
    userName: manifest.userName,
    createdAt: manifest.createdAt,
    window: {
      startTime: assertFiniteTimestamp(window?.startTime, 'window.startTime'),
      endTime: assertFiniteTimestamp(window?.endTime, 'window.endTime'),
    },
    payload: {
      file: RUNTIME_EVIDENCE_PAYLOAD_FILE,
      sha256: payload.sha256,
      bytes: payload.bytes,
    },
    counts: Object.fromEntries(
      Object.entries(counts ?? {}).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1]),
      ),
    ),
    lineageKeys: manifest.lineageKeys.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  };
};

export const publishRuntimeEvidenceBundle = async ({
  publishRoot,
  deploymentId,
  userName,
  startTime,
  endTime,
  artifact,
  counts,
  lineageKeys,
}: {
  publishRoot: string;
  deploymentId: string;
  userName: string;
  startTime: number;
  endTime: number;
  artifact: Record<string, unknown>;
  counts: Record<string, number>;
  lineageKeys: string[];
}) => {
  const payload = `${JSON.stringify(artifact, null, 2)}\n`;
  const payloadSha256 = sha256(payload);
  const identitySha256 = runtimeEvidenceIdentitySha256(artifact);
  const safeDeploymentId = safeSegment(deploymentId, 'default');
  const artifactId = [
    compactTimestamp(startTime),
    compactTimestamp(endTime),
    identitySha256.slice(0, 16),
  ].join('_');
  const createdAt = Date.now();
  const manifest: RuntimeEvidenceArtifactManifest = {
    schemaVersion: 1,
    artifactId,
    reportType: 'runtime-evidence',
    deploymentId: safeDeploymentId,
    userName,
    createdAt,
    window: { startTime, endTime },
    payload: {
      file: RUNTIME_EVIDENCE_PAYLOAD_FILE,
      sha256: payloadSha256,
      bytes: Buffer.byteLength(payload),
    },
    counts,
    lineageKeys: [...new Set(lineageKeys)].sort(),
  };
  const incomingRoot = path.join(publishRoot, 'incoming');
  const readyRoot = path.join(
    publishRoot,
    'ready',
    safeDeploymentId,
    ...dateParts(endTime),
  );
  const bundleDir = path.join(readyRoot, artifactId);
  const temporaryDir = path.join(
    incomingRoot,
    `${artifactId}.tmp-${randomUUID()}`,
  );

  await fs.mkdir(temporaryDir, { recursive: true });
  try {
    await Promise.all([
      fs.writeFile(
        path.join(temporaryDir, RUNTIME_EVIDENCE_PAYLOAD_FILE),
        payload,
        'utf8',
      ),
      fs.writeFile(
        path.join(temporaryDir, RUNTIME_EVIDENCE_MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      ),
    ]);
    await fs.writeFile(
      path.join(temporaryDir, RUNTIME_EVIDENCE_COMPLETE_FILE),
      `${artifactId}\n`,
      'utf8',
    );
    await fs.mkdir(readyRoot, { recursive: true });
    try {
      await fs.rename(temporaryDir, bundleDir);
    } catch (error) {
      if (!isExistingDestinationError(error)) {
        throw error;
      }
      await fs.rm(temporaryDir, { recursive: true, force: true });
    }
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }

  return verifyRuntimeEvidenceBundle(bundleDir);
};

export const verifyRuntimeEvidenceBundle = async (
  bundleDir: string,
): Promise<VerifiedRuntimeEvidenceBundle> => {
  const manifestPath = path.join(bundleDir, RUNTIME_EVIDENCE_MANIFEST_FILE);
  const payloadPath = path.join(bundleDir, RUNTIME_EVIDENCE_PAYLOAD_FILE);
  const completePath = path.join(bundleDir, RUNTIME_EVIDENCE_COMPLETE_FILE);
  const [manifestText, payload, completeText] = await Promise.all([
    fs.readFile(manifestPath, 'utf8'),
    fs.readFile(payloadPath),
    fs.readFile(completePath, 'utf8'),
  ]);
  const manifest = parseManifest(JSON.parse(manifestText));

  if (completeText.trim() !== manifest.artifactId) {
    throw new Error(`Invalid completion marker in ${bundleDir}`);
  }
  if (payload.byteLength !== manifest.payload.bytes) {
    throw new Error(`Runtime evidence size mismatch in ${bundleDir}`);
  }
  if (sha256(payload) !== manifest.payload.sha256) {
    throw new Error(`Runtime evidence checksum mismatch in ${bundleDir}`);
  }

  const artifact = asRecord(JSON.parse(payload.toString('utf8')));
  const artifactWindow = asRecord(artifact?.window);
  if (
    artifact?.reportType !== 'runtime-evidence' ||
    artifactWindow?.startTime !== manifest.window.startTime ||
    artifactWindow.endTime !== manifest.window.endTime
  ) {
    throw new Error(`Runtime evidence payload mismatch in ${bundleDir}`);
  }

  return {
    bundleDir,
    manifestPath,
    payloadPath,
    manifest,
    artifact,
  };
};

export const discoverRuntimeEvidenceBundles = async (rootDir: string) => {
  const bundles: string[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    const names = new Set(entries.map((entry) => entry.name));
    if (
      names.has(RUNTIME_EVIDENCE_MANIFEST_FILE) &&
      names.has(RUNTIME_EVIDENCE_PAYLOAD_FILE) &&
      names.has(RUNTIME_EVIDENCE_COMPLETE_FILE)
    ) {
      bundles.push(directory);
      return;
    }

    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !entry.name.includes('.tmp-'),
        )
        .map((entry) => visit(path.join(directory, entry.name), depth + 1)),
    );
  };

  await visit(rootDir, 0);
  return bundles.sort();
};
