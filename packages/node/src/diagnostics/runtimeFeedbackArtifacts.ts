import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
} from './runtimeEvidenceDeployment';
import {
  verifyRuntimeEvidenceBundle,
  type VerifiedRuntimeEvidenceBundle,
} from './runtimeEvidenceArtifacts';
import {
  parseRuntimeEvidenceProducer,
  type RuntimeEvidenceProducer,
} from './runtimeEvidenceProducer';

export const RUNTIME_FEEDBACK_MANIFEST_FILE = 'manifest.json';
export const RUNTIME_FEEDBACK_REPLAY_FILE = 'replay-runtime-evidence.json';
export const RUNTIME_FEEDBACK_LOG_FILE = 'replay.log';
export const RUNTIME_FEEDBACK_COMPLETE_FILE = '.complete';

type PayloadDescriptor = {
  file: string;
  sha256: string;
  bytes: number;
};

export type RuntimeFeedbackReplayManifest = {
  schemaVersion: 1;
  reportType: 'runtime-feedback-replay';
  artifactId: string;
  runId: string;
  deploymentId: string;
  deploymentCompositionId: string;
  userName: string;
  createdAt: number;
  window: {
    startTime: number;
    endTime: number;
  };
  runtimeEvidence: {
    artifactId: string;
    payloadSha256: string;
  };
  producer: RuntimeEvidenceProducer;
  activeStrategies: string[];
  cycleCount: number;
  safety: {
    cacheOnly: true;
    externalOrderPlacement: false;
    redis: 'isolated';
    timescale: 'read_only';
  };
  payloads: {
    replayEvidence: PayloadDescriptor & {
      file: typeof RUNTIME_FEEDBACK_REPLAY_FILE;
    };
    log: PayloadDescriptor & {
      file: typeof RUNTIME_FEEDBACK_LOG_FILE;
    };
  };
};

export type VerifiedRuntimeFeedbackReplayBundle = {
  bundleDir: string;
  manifestPath: string;
  replayEvidencePath: string;
  logPath: string;
  manifest: RuntimeFeedbackReplayManifest;
  replayEvidence: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const sha256 = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

const safeSegment = (value: string, fallback: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized && normalized !== '.' && normalized !== '..'
    ? normalized
    : fallback;
};

const parsePayload = (
  value: unknown,
  expectedFile: string,
): PayloadDescriptor => {
  const payload = isRecord(value) ? value : null;
  if (
    payload?.file !== expectedFile ||
    typeof payload.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(payload.sha256) ||
    typeof payload.bytes !== 'number' ||
    !Number.isFinite(payload.bytes) ||
    payload.bytes < 0
  ) {
    throw new Error(`Invalid runtime feedback payload: ${expectedFile}`);
  }
  return payload as unknown as PayloadDescriptor;
};

const parseManifest = (value: unknown): RuntimeFeedbackReplayManifest => {
  const manifest = isRecord(value) ? value : null;
  const window = isRecord(manifest?.window) ? manifest.window : null;
  const runtimeEvidence = isRecord(manifest?.runtimeEvidence)
    ? manifest.runtimeEvidence
    : null;
  const safety = isRecord(manifest?.safety) ? manifest.safety : null;
  const payloads = isRecord(manifest?.payloads) ? manifest.payloads : null;

  if (
    manifest?.schemaVersion !== 1 ||
    manifest.reportType !== 'runtime-feedback-replay' ||
    typeof manifest.artifactId !== 'string' ||
    !manifest.artifactId.trim() ||
    typeof manifest.runId !== 'string' ||
    !manifest.runId.trim() ||
    typeof manifest.deploymentId !== 'string' ||
    !manifest.deploymentId.trim() ||
    typeof manifest.deploymentCompositionId !== 'string' ||
    !/^dc1:[a-f0-9]{16}$/.test(manifest.deploymentCompositionId) ||
    typeof manifest.userName !== 'string' ||
    !manifest.userName.trim() ||
    typeof manifest.createdAt !== 'number' ||
    typeof window?.startTime !== 'number' ||
    typeof window.endTime !== 'number' ||
    typeof runtimeEvidence?.artifactId !== 'string' ||
    typeof runtimeEvidence.payloadSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(runtimeEvidence.payloadSha256) ||
    !Array.isArray(manifest.activeStrategies) ||
    manifest.activeStrategies.length === 0 ||
    !manifest.activeStrategies.every(
      (strategy) => typeof strategy === 'string' && strategy.trim(),
    ) ||
    typeof manifest.cycleCount !== 'number' ||
    !Number.isFinite(manifest.cycleCount) ||
    manifest.cycleCount <= 0 ||
    safety?.cacheOnly !== true ||
    safety.externalOrderPlacement !== false ||
    safety.redis !== 'isolated' ||
    safety.timescale !== 'read_only'
  ) {
    throw new Error('Invalid runtime feedback replay manifest');
  }

  const replayEvidence = parsePayload(
    payloads?.replayEvidence,
    RUNTIME_FEEDBACK_REPLAY_FILE,
  );
  const log = parsePayload(payloads?.log, RUNTIME_FEEDBACK_LOG_FILE);

  return {
    ...(manifest as unknown as RuntimeFeedbackReplayManifest),
    producer: parseRuntimeEvidenceProducer(manifest.producer),
    payloads: {
      replayEvidence: {
        ...replayEvidence,
        file: RUNTIME_FEEDBACK_REPLAY_FILE,
      },
      log: { ...log, file: RUNTIME_FEEDBACK_LOG_FILE },
    },
  };
};

const assertReplayMatchesRuntimeEvidence = ({
  replayEvidence,
  runtimeEvidence,
}: {
  replayEvidence: Record<string, unknown>;
  runtimeEvidence: VerifiedRuntimeEvidenceBundle;
}) => {
  if (replayEvidence.reportType !== 'replay-runtime-evidence') {
    throw new Error('Runtime feedback replay payload has the wrong reportType');
  }
  const replayWindow = isRecord(replayEvidence.window)
    ? replayEvidence.window
    : null;
  if (
    replayWindow?.startTime !== runtimeEvidence.manifest.window.startTime ||
    replayWindow.endTime !== runtimeEvidence.manifest.window.endTime
  ) {
    throw new Error('Runtime feedback replay window does not match evidence');
  }
  const runtimeDeployment = parseRuntimeEvidenceDeploymentSnapshot(
    runtimeEvidence.artifact.deployment,
  );
  const replayDeployment = parseRuntimeEvidenceDeploymentSnapshot(
    replayEvidence.deployment,
  );
  if (
    replayDeployment.id !== runtimeDeployment.id ||
    replayDeployment.deploymentCompositionId !==
      runtimeDeployment.deploymentCompositionId
  ) {
    throw new Error(
      'Runtime feedback replay deployment does not match evidence',
    );
  }
};

export const sealRuntimeFeedbackReplayBundle = async ({
  bundleDir,
  runId,
  runtimeEvidenceBundle,
}: {
  bundleDir: string;
  runId: string;
  runtimeEvidenceBundle: VerifiedRuntimeEvidenceBundle;
}): Promise<VerifiedRuntimeFeedbackReplayBundle> => {
  const replayEvidencePath = path.join(bundleDir, RUNTIME_FEEDBACK_REPLAY_FILE);
  const logPath = path.join(bundleDir, RUNTIME_FEEDBACK_LOG_FILE);
  const [replayPayload, logPayload] = await Promise.all([
    fs.readFile(replayEvidencePath),
    fs.readFile(logPath),
  ]);
  const replayEvidence = JSON.parse(replayPayload.toString('utf8')) as Record<
    string,
    unknown
  >;
  assertReplayMatchesRuntimeEvidence({
    replayEvidence,
    runtimeEvidence: runtimeEvidenceBundle,
  });

  const replay = isRecord(replayEvidence.replay) ? replayEvidence.replay : null;
  const cycleCount = Number(replay?.cycleCount);
  if (!Number.isFinite(cycleCount) || cycleCount <= 0) {
    throw new Error(
      `Runtime feedback replay produced no comparable cycles: ${String(replay?.cycleCount ?? 'missing')}`,
    );
  }

  const deployment = parseRuntimeEvidenceDeploymentSnapshot(
    runtimeEvidenceBundle.artifact.deployment,
  );
  const producer = parseRuntimeEvidenceProducer(
    runtimeEvidenceBundle.artifact.producer,
  );
  const safeRunId = safeSegment(runId, 'run');
  const artifactId = `${runtimeEvidenceBundle.manifest.artifactId}_${safeRunId}`;
  const manifest: RuntimeFeedbackReplayManifest = {
    schemaVersion: 1,
    reportType: 'runtime-feedback-replay',
    artifactId,
    runId: safeRunId,
    deploymentId: deployment.id,
    deploymentCompositionId: deployment.deploymentCompositionId,
    userName: runtimeEvidenceBundle.manifest.userName,
    createdAt: Date.now(),
    window: { ...runtimeEvidenceBundle.manifest.window },
    runtimeEvidence: {
      artifactId: runtimeEvidenceBundle.manifest.artifactId,
      payloadSha256: runtimeEvidenceBundle.manifest.payload.sha256,
    },
    producer,
    activeStrategies: activeRuntimeEvidenceStrategies(deployment).map(
      ({ strategyName }) => strategyName,
    ),
    cycleCount,
    safety: {
      cacheOnly: true,
      externalOrderPlacement: false,
      redis: 'isolated',
      timescale: 'read_only',
    },
    payloads: {
      replayEvidence: {
        file: RUNTIME_FEEDBACK_REPLAY_FILE,
        sha256: sha256(replayPayload),
        bytes: replayPayload.byteLength,
      },
      log: {
        file: RUNTIME_FEEDBACK_LOG_FILE,
        sha256: sha256(logPayload),
        bytes: logPayload.byteLength,
      },
    },
  };
  await fs.writeFile(
    path.join(bundleDir, RUNTIME_FEEDBACK_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(bundleDir, RUNTIME_FEEDBACK_COMPLETE_FILE),
    `${artifactId}\n`,
    'utf8',
  );

  return verifyRuntimeFeedbackReplayBundle(bundleDir);
};

export const verifyRuntimeFeedbackReplayBundle = async (
  bundleDir: string,
): Promise<VerifiedRuntimeFeedbackReplayBundle> => {
  const manifestPath = path.join(bundleDir, RUNTIME_FEEDBACK_MANIFEST_FILE);
  const replayEvidencePath = path.join(bundleDir, RUNTIME_FEEDBACK_REPLAY_FILE);
  const logPath = path.join(bundleDir, RUNTIME_FEEDBACK_LOG_FILE);
  const completePath = path.join(bundleDir, RUNTIME_FEEDBACK_COMPLETE_FILE);
  const [manifestText, replayPayload, logPayload, completeText] =
    await Promise.all([
      fs.readFile(manifestPath, 'utf8'),
      fs.readFile(replayEvidencePath),
      fs.readFile(logPath),
      fs.readFile(completePath, 'utf8'),
    ]);
  const manifest = parseManifest(JSON.parse(manifestText));
  if (completeText.trim() !== manifest.artifactId) {
    throw new Error(`Invalid runtime feedback completion marker: ${bundleDir}`);
  }
  for (const [payload, descriptor] of [
    [replayPayload, manifest.payloads.replayEvidence],
    [logPayload, manifest.payloads.log],
  ] as const) {
    if (payload.byteLength !== descriptor.bytes) {
      throw new Error(
        `Runtime feedback payload size mismatch: ${descriptor.file}`,
      );
    }
    if (sha256(payload) !== descriptor.sha256) {
      throw new Error(
        `Runtime feedback payload checksum mismatch: ${descriptor.file}`,
      );
    }
  }
  const replayEvidence = JSON.parse(replayPayload.toString('utf8')) as Record<
    string,
    unknown
  >;
  if (replayEvidence.reportType !== 'replay-runtime-evidence') {
    throw new Error('Invalid runtime feedback replay evidence payload');
  }
  const replayWindow = isRecord(replayEvidence.window)
    ? replayEvidence.window
    : null;
  const replay = isRecord(replayEvidence.replay) ? replayEvidence.replay : null;
  const replayDeployment = parseRuntimeEvidenceDeploymentSnapshot(
    replayEvidence.deployment,
  );
  const replayStrategies = activeRuntimeEvidenceStrategies(replayDeployment)
    .map(({ strategyName }) => strategyName)
    .sort();
  if (
    replayEvidence.userName !== manifest.userName ||
    replayWindow?.startTime !== manifest.window.startTime ||
    replayWindow.endTime !== manifest.window.endTime ||
    replayDeployment.id !== manifest.deploymentId ||
    replayDeployment.deploymentCompositionId !==
      manifest.deploymentCompositionId ||
    Number(replay?.cycleCount) !== manifest.cycleCount ||
    JSON.stringify(replayStrategies) !==
      JSON.stringify([...manifest.activeStrategies].sort())
  ) {
    throw new Error('Runtime feedback replay payload does not match manifest');
  }

  return {
    bundleDir,
    manifestPath,
    replayEvidencePath,
    logPath,
    manifest,
    replayEvidence,
  };
};

export const discoverRuntimeFeedbackReplayBundles = async (rootDir: string) => {
  const bundles: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 10) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const names = new Set(entries.map((entry) => entry.name));
    if (
      names.has(RUNTIME_FEEDBACK_MANIFEST_FILE) &&
      names.has(RUNTIME_FEEDBACK_REPLAY_FILE) &&
      names.has(RUNTIME_FEEDBACK_LOG_FILE) &&
      names.has(RUNTIME_FEEDBACK_COMPLETE_FILE)
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

export const verifyRuntimeFeedbackReplaySource = async ({
  bundleDir,
  runtimeEvidenceBundleDir,
}: {
  bundleDir: string;
  runtimeEvidenceBundleDir: string;
}) => {
  const [feedback, runtimeEvidence] = await Promise.all([
    verifyRuntimeFeedbackReplayBundle(bundleDir),
    verifyRuntimeEvidenceBundle(runtimeEvidenceBundleDir),
  ]);
  if (
    feedback.manifest.runtimeEvidence.artifactId !==
      runtimeEvidence.manifest.artifactId ||
    feedback.manifest.runtimeEvidence.payloadSha256 !==
      runtimeEvidence.manifest.payload.sha256
  ) {
    throw new Error('Runtime feedback bundle references different evidence');
  }
  assertReplayMatchesRuntimeEvidence({
    replayEvidence: feedback.replayEvidence,
    runtimeEvidence,
  });
  return { feedback, runtimeEvidence };
};
