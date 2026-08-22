import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
  type VerifiedRuntimeEvidenceBundle,
} from './runtimeEvidenceArtifacts';
import { assertCurrentRuntimeEvidenceArtifact } from './runtimeEvidenceDeployment';

const execFileAsync = promisify(execFile);

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

const withTrailingSlash = (value: string) =>
  value.endsWith('/') ? value : `${value}/`;

const dateParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
};

export const buildRuntimeEvidenceRsyncArgs = ({
  source,
  destination,
}: {
  source: string;
  destination: string;
}) => [
  '--recursive',
  '--times',
  '--partial',
  '--partial-dir=.rsync-partial',
  '--prune-empty-dirs',
  withTrailingSlash(source),
  withTrailingSlash(destination),
];

const receiptPath = (receiptsRoot: string, artifactId: string) =>
  path.join(receiptsRoot, `${safeSegment(artifactId, 'artifact')}.json`);

const compareBundles = (
  left: VerifiedRuntimeEvidenceBundle,
  right: VerifiedRuntimeEvidenceBundle,
) =>
  left.manifest.window.endTime - right.manifest.window.endTime ||
  left.manifest.createdAt - right.manifest.createdAt;

export const listPendingRuntimeEvidenceBundles = async ({
  evidenceRoot,
  deploymentId,
}: {
  evidenceRoot: string;
  deploymentId: string;
}) => {
  const safeDeploymentId = safeSegment(deploymentId, 'production');
  const artifactsRoot = path.join(evidenceRoot, 'artifacts', safeDeploymentId);
  const receiptsRoot = path.join(evidenceRoot, 'receipts', safeDeploymentId);
  const bundles = await discoverRuntimeEvidenceBundles(artifactsRoot);
  const pending: VerifiedRuntimeEvidenceBundle[] = [];

  for (const bundleDir of bundles) {
    const verified = await verifyRuntimeEvidenceBundle(bundleDir);
    if (verified.manifest.deploymentId !== safeDeploymentId) continue;
    assertCurrentRuntimeEvidenceArtifact(verified.artifact);

    try {
      await fs.access(receiptPath(receiptsRoot, verified.manifest.artifactId));
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    pending.push(verified);
  }

  return pending.sort(compareBundles);
};

export const markRuntimeEvidenceBundleProcessed = async ({
  evidenceRoot,
  deploymentId,
  bundleDir,
  scorecardPath,
}: {
  evidenceRoot: string;
  deploymentId: string;
  bundleDir: string;
  scorecardPath?: string | null;
}) => {
  const safeDeploymentId = safeSegment(deploymentId, 'production');
  const verified = await verifyRuntimeEvidenceBundle(bundleDir);
  if (verified.manifest.deploymentId !== safeDeploymentId) {
    throw new Error(
      `Artifact deployment mismatch: expected ${safeDeploymentId}, received ${verified.manifest.deploymentId}`,
    );
  }
  const receiptsRoot = path.join(evidenceRoot, 'receipts', safeDeploymentId);
  const finalPath = receiptPath(receiptsRoot, verified.manifest.artifactId);
  const temporaryPath = `${finalPath}.tmp-${process.pid}`;
  const receipt = {
    schemaVersion: 1,
    artifactId: verified.manifest.artifactId,
    payloadSha256: verified.manifest.payload.sha256,
    processedAt: Date.now(),
    scorecardPath: scorecardPath ?? null,
  };

  await fs.mkdir(receiptsRoot, { recursive: true });
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  await fs.rename(temporaryPath, finalPath);
  return finalPath;
};

export const syncRuntimeEvidenceBundles = async ({
  source,
  evidenceRoot,
  deploymentId,
  runRsync = async (args: string[]) => {
    const result = await execFileAsync('rsync', args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
}: {
  source: string;
  evidenceRoot: string;
  deploymentId: string;
  runRsync?: (
    args: string[],
  ) => Promise<{ stdout?: string | Buffer; stderr?: string | Buffer }>;
}) => {
  const safeDeploymentId = safeSegment(deploymentId, 'production');
  const inboxRoot = path.join(evidenceRoot, 'inbox', safeDeploymentId);
  const artifactsRoot = path.join(evidenceRoot, 'artifacts', safeDeploymentId);
  await Promise.all([
    fs.mkdir(inboxRoot, { recursive: true }),
    fs.mkdir(artifactsRoot, { recursive: true }),
  ]);

  const rsyncArgs = buildRuntimeEvidenceRsyncArgs({
    source,
    destination: inboxRoot,
  });
  const transfer = await runRsync(rsyncArgs);
  const discovered = await discoverRuntimeEvidenceBundles(inboxRoot);
  const received: VerifiedRuntimeEvidenceBundle[] = [];

  for (const bundleDir of discovered) {
    const verified = await verifyRuntimeEvidenceBundle(bundleDir);
    if (verified.manifest.deploymentId !== safeDeploymentId) {
      throw new Error(
        `Artifact deployment mismatch: expected ${safeDeploymentId}, received ${verified.manifest.deploymentId}`,
      );
    }
    assertCurrentRuntimeEvidenceArtifact(verified.artifact);
    const destinationDir = path.join(
      artifactsRoot,
      ...dateParts(verified.manifest.window.endTime),
      safeSegment(verified.manifest.artifactId, 'artifact'),
    );
    await fs.mkdir(path.dirname(destinationDir), { recursive: true });

    try {
      await fs.rename(bundleDir, destinationDir);
    } catch (error) {
      if (!isExistingDestinationError(error)) throw error;
      const existing = await verifyRuntimeEvidenceBundle(destinationDir);
      if (
        existing.manifest.payload.sha256 !== verified.manifest.payload.sha256
      ) {
        throw new Error(
          `Conflicting runtime evidence artifact ${verified.manifest.artifactId}`,
        );
      }
      await fs.rm(bundleDir, { recursive: true, force: true });
    }
    received.push(await verifyRuntimeEvidenceBundle(destinationDir));
  }

  const pending = await listPendingRuntimeEvidenceBundles({
    evidenceRoot,
    deploymentId: safeDeploymentId,
  });

  return {
    rsyncArgs,
    stdout: String(transfer.stdout ?? ''),
    stderr: String(transfer.stderr ?? ''),
    received,
    pending,
  };
};
