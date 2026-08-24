import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  discoverRuntimeFeedbackReplayBundles,
  verifyRuntimeFeedbackReplayBundle,
  type VerifiedRuntimeFeedbackReplayBundle,
} from './runtimeFeedbackArtifacts';
import { buildRuntimeEvidenceRsyncArgs } from './runtimeEvidenceSync';

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

const dateParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ];
};

export const syncRuntimeFeedbackReplayBundles = async ({
  source,
  feedbackRoot,
  deploymentId,
  runRsync = async (args: string[]) => {
    const result = await execFileAsync('rsync', args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
}: {
  source: string;
  feedbackRoot: string;
  deploymentId: string;
  runRsync?: (
    args: string[],
  ) => Promise<{ stdout?: string | Buffer; stderr?: string | Buffer }>;
}) => {
  const safeDeploymentId = safeSegment(deploymentId, 'production');
  const inboxRoot = path.join(feedbackRoot, 'inbox', safeDeploymentId);
  const artifactsRoot = path.join(feedbackRoot, 'artifacts', safeDeploymentId);
  await Promise.all([
    fs.mkdir(inboxRoot, { recursive: true }),
    fs.mkdir(artifactsRoot, { recursive: true }),
  ]);

  const rsyncArgs = buildRuntimeEvidenceRsyncArgs({
    source,
    destination: inboxRoot,
  });
  const transfer = await runRsync(rsyncArgs);
  const discovered = await discoverRuntimeFeedbackReplayBundles(inboxRoot);
  const received: VerifiedRuntimeFeedbackReplayBundle[] = [];

  for (const bundleDir of discovered) {
    const verified = await verifyRuntimeFeedbackReplayBundle(bundleDir);
    if (verified.manifest.deploymentId !== safeDeploymentId) {
      throw new Error(
        `Runtime feedback deployment mismatch: expected ${safeDeploymentId}, received ${verified.manifest.deploymentId}`,
      );
    }
    const destinationDir = path.join(
      artifactsRoot,
      ...dateParts(verified.manifest.window.endTime),
      safeSegment(verified.manifest.runtimeEvidence.artifactId, 'artifact'),
      safeSegment(verified.manifest.runId, 'run'),
    );
    await fs.mkdir(path.dirname(destinationDir), { recursive: true });
    try {
      await fs.rename(bundleDir, destinationDir);
    } catch (error) {
      if (!isExistingDestinationError(error)) throw error;
      const existing = await verifyRuntimeFeedbackReplayBundle(destinationDir);
      if (
        existing.manifest.payloads.replayEvidence.sha256 !==
        verified.manifest.payloads.replayEvidence.sha256
      ) {
        throw new Error(
          `Conflicting runtime feedback replay ${verified.manifest.artifactId}`,
        );
      }
      await fs.rm(bundleDir, { recursive: true, force: true });
    }
    received.push(await verifyRuntimeFeedbackReplayBundle(destinationDir));
  }

  return {
    rsyncArgs,
    stdout: String(transfer.stdout ?? ''),
    stderr: String(transfer.stderr ?? ''),
    received,
  };
};
