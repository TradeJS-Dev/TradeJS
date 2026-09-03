import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseRuntimeEvidenceDeploymentSnapshot,
  resolveRuntimeEvidenceDeploymentSnapshot,
  type RuntimeEvidenceDeploymentSnapshot,
} from './runtimeEvidenceDeployment';
import {
  parseRuntimeEvidenceProducer,
  resolveRuntimeEvidenceProducer,
  type RuntimeEvidenceProducer,
} from './runtimeEvidenceProducer';

const SNAPSHOT_FILE = 'snapshot.json';
const MANIFEST_FILE = 'manifest.json';
const COMPLETE_FILE = '.complete';

type RuntimeEvidenceCompositionSnapshotPayload = {
  schemaVersion: 1;
  reportType: 'runtime-evidence-composition-snapshot';
  createdAt: number;
  userName: string;
  deployment: RuntimeEvidenceDeploymentSnapshot;
  producer: RuntimeEvidenceProducer;
};

type RuntimeEvidenceCompositionSnapshotManifest = {
  schemaVersion: 1;
  reportType: 'runtime-evidence-composition-snapshot';
  createdAt: number;
  userName: string;
  deploymentId: string;
  deploymentCompositionId: string;
  payload: {
    file: typeof SNAPSHOT_FILE;
    sha256: string;
    bytes: number;
  };
};

export type VerifiedRuntimeEvidenceCompositionSnapshot = {
  bundleDir: string;
  deployment: RuntimeEvidenceDeploymentSnapshot;
  producer: RuntimeEvidenceProducer;
};

export const createRuntimeEvidenceCompositionSnapshotRecorder = ({
  persist,
  onError,
}: {
  persist: (compositionId: string) => Promise<void>;
  onError: (compositionId: string, error: unknown) => void;
}) => {
  const completed = new Set<string>();
  const inFlight = new Set<string>();

  return {
    observe(compositionId: string) {
      if (completed.has(compositionId) || inFlight.has(compositionId)) return;

      inFlight.add(compositionId);
      void Promise.resolve()
        .then(() => persist(compositionId))
        .then(() => completed.add(compositionId))
        .catch((error: unknown) => onError(compositionId, error))
        .finally(() => inFlight.delete(compositionId));
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

const safeSegment = (value: string, label: string) => {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new Error(`Invalid runtime evidence snapshot ${label}`);
  }
  return normalized;
};

const isExistingDestinationError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
};

const parseManifest = (
  value: unknown,
): RuntimeEvidenceCompositionSnapshotManifest => {
  const manifest = isRecord(value) ? value : null;
  const payload = isRecord(manifest?.payload) ? manifest.payload : null;
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.reportType !== 'runtime-evidence-composition-snapshot' ||
    typeof manifest.createdAt !== 'number' ||
    typeof manifest.userName !== 'string' ||
    typeof manifest.deploymentId !== 'string' ||
    typeof manifest.deploymentCompositionId !== 'string' ||
    payload?.file !== SNAPSHOT_FILE ||
    typeof payload.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(payload.sha256) ||
    typeof payload.bytes !== 'number'
  ) {
    throw new Error('Invalid runtime evidence composition snapshot manifest');
  }
  return manifest as unknown as RuntimeEvidenceCompositionSnapshotManifest;
};

export const verifyRuntimeEvidenceCompositionSnapshot = async (
  bundleDir: string,
): Promise<VerifiedRuntimeEvidenceCompositionSnapshot> => {
  const [manifestText, payload, completeText] = await Promise.all([
    fs.readFile(path.join(bundleDir, MANIFEST_FILE), 'utf8'),
    fs.readFile(path.join(bundleDir, SNAPSHOT_FILE)),
    fs.readFile(path.join(bundleDir, COMPLETE_FILE), 'utf8'),
  ]);
  const manifest = parseManifest(JSON.parse(manifestText));
  if (completeText.trim() !== manifest.deploymentCompositionId) {
    throw new Error(`Invalid completion marker in ${bundleDir}`);
  }
  if (
    payload.byteLength !== manifest.payload.bytes ||
    sha256(payload) !== manifest.payload.sha256
  ) {
    throw new Error(
      `Runtime evidence snapshot checksum mismatch in ${bundleDir}`,
    );
  }

  const value = JSON.parse(payload.toString('utf8')) as unknown;
  const record = isRecord(value) ? value : null;
  if (
    record?.schemaVersion !== 1 ||
    record.reportType !== 'runtime-evidence-composition-snapshot' ||
    record.userName !== manifest.userName
  ) {
    throw new Error(
      `Invalid runtime evidence snapshot payload in ${bundleDir}`,
    );
  }
  const deployment = parseRuntimeEvidenceDeploymentSnapshot(record.deployment);
  const producer = parseRuntimeEvidenceProducer(record.producer);
  if (
    deployment.id !== manifest.deploymentId ||
    deployment.deploymentCompositionId !== manifest.deploymentCompositionId
  ) {
    throw new Error(
      `Runtime evidence snapshot identity mismatch in ${bundleDir}`,
    );
  }

  return { bundleDir, deployment, producer };
};

const sameSnapshot = (
  snapshot: VerifiedRuntimeEvidenceCompositionSnapshot,
  deployment: RuntimeEvidenceDeploymentSnapshot,
  producer: RuntimeEvidenceProducer,
) =>
  JSON.stringify(snapshot.deployment) === JSON.stringify(deployment) &&
  JSON.stringify(snapshot.producer) === JSON.stringify(producer);

export const publishRuntimeEvidenceCompositionSnapshot = async ({
  evidenceRoot,
  userName,
  deployment,
  producer,
}: {
  evidenceRoot: string;
  userName: string;
  deployment: RuntimeEvidenceDeploymentSnapshot;
  producer: RuntimeEvidenceProducer;
}) => {
  const deploymentId = safeSegment(deployment.id, 'deployment id');
  const compositionId = safeSegment(
    deployment.deploymentCompositionId,
    'composition id',
  );
  const createdAt = Date.now();
  const snapshot: RuntimeEvidenceCompositionSnapshotPayload = {
    schemaVersion: 1,
    reportType: 'runtime-evidence-composition-snapshot',
    createdAt,
    userName,
    deployment,
    producer,
  };
  const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
  const manifest: RuntimeEvidenceCompositionSnapshotManifest = {
    schemaVersion: 1,
    reportType: 'runtime-evidence-composition-snapshot',
    createdAt,
    userName,
    deploymentId,
    deploymentCompositionId: compositionId,
    payload: {
      file: SNAPSHOT_FILE,
      sha256: sha256(payload),
      bytes: Buffer.byteLength(payload),
    },
  };
  const snapshotsRoot = path.join(evidenceRoot, 'snapshots', deploymentId);
  const bundleDir = path.join(snapshotsRoot, compositionId);
  const temporaryDir = path.join(
    evidenceRoot,
    'incoming',
    `snapshot-${compositionId}.tmp-${randomUUID()}`,
  );

  await fs.mkdir(temporaryDir, { recursive: true });
  try {
    await Promise.all([
      fs.writeFile(path.join(temporaryDir, SNAPSHOT_FILE), payload, 'utf8'),
      fs.writeFile(
        path.join(temporaryDir, MANIFEST_FILE),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      ),
    ]);
    await fs.writeFile(
      path.join(temporaryDir, COMPLETE_FILE),
      `${compositionId}\n`,
      'utf8',
    );
    await fs.mkdir(snapshotsRoot, { recursive: true });
    try {
      await fs.rename(temporaryDir, bundleDir);
    } catch (error) {
      if (!isExistingDestinationError(error)) throw error;
      await fs.rm(temporaryDir, { recursive: true, force: true });
    }
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }

  const verified = await verifyRuntimeEvidenceCompositionSnapshot(bundleDir);
  if (!sameSnapshot(verified, deployment, producer)) {
    throw new Error(
      `Conflicting runtime evidence snapshot for composition ${compositionId}`,
    );
  }
  return verified;
};

export const captureRuntimeEvidenceCompositionSnapshot = async ({
  projectRoot,
  userName,
  deploymentId,
  expectedCompositionId,
}: {
  projectRoot: string;
  userName: string;
  deploymentId: string;
  expectedCompositionId: string;
}) => {
  const [deployment, producer] = await Promise.all([
    resolveRuntimeEvidenceDeploymentSnapshot({
      userName,
      projectRoot,
      deploymentId,
    }),
    resolveRuntimeEvidenceProducer({ projectRoot, required: true }),
  ]);
  if (!producer) {
    throw new Error('Runtime evidence producer identity is required');
  }
  if (deployment.deploymentCompositionId !== expectedCompositionId) {
    throw new Error(
      `Runtime deployment composition changed while capturing snapshot: expected ${expectedCompositionId}, received ${deployment.deploymentCompositionId}`,
    );
  }

  await publishRuntimeEvidenceCompositionSnapshot({
    evidenceRoot: path.join(projectRoot, 'data', 'runtime-evidence'),
    userName,
    deployment,
    producer,
  });
};

export const discoverRuntimeEvidenceCompositionSnapshots = async (
  evidenceRoot: string,
) => {
  const rootDir = path.join(evidenceRoot, 'snapshots');
  const bundleDirs: string[] = [];
  let deployments: Dirent[];
  try {
    deployments = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  for (const deployment of deployments.filter((entry) => entry.isDirectory())) {
    const deploymentDir = path.join(rootDir, deployment.name);
    const compositions = await fs.readdir(deploymentDir, {
      withFileTypes: true,
    });
    bundleDirs.push(
      ...compositions
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !entry.name.includes('.tmp-'),
        )
        .map((entry) => path.join(deploymentDir, entry.name)),
    );
  }
  return Promise.all(
    bundleDirs.sort().map(verifyRuntimeEvidenceCompositionSnapshot),
  );
};
