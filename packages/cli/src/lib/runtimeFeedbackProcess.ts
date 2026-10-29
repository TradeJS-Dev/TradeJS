import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
  verifyRuntimeFeedbackReplaySource,
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
} from '@tradejs/node/diagnostics';
import { buildExecutionCalibrationReport } from './executionCalibration';
import {
  buildRuntimeScorecard,
  formatRuntimeScorecardMarkdown,
} from './runtimeScorecard';
import { markRuntimeEvidenceBundleProcessed } from './runtimeEvidenceSync';

/** Process one already downloaded exact pair. Never runs replay or changes runtime. */
export const processRuntimeFeedbackPair = async ({
  runtimeDir,
  replayDir,
  evidenceRoot,
  outputRoot,
  historyDir,
}: {
  runtimeDir: string;
  replayDir: string;
  evidenceRoot: string;
  outputRoot: string;
  historyDir?: string;
}) => {
  const { runtimeEvidence, feedback } = await verifyRuntimeFeedbackReplaySource(
    { bundleDir: replayDir, runtimeEvidenceBundleDir: runtimeDir },
  );
  const { artifactId, deploymentId } = runtimeEvidence.manifest;
  const snapshot = parseRuntimeEvidenceDeploymentSnapshot(
    runtimeEvidence.artifact.deployment,
  );
  if (!snapshot)
    throw new Error('Runtime evidence requires a deployment snapshot');
  const strategies = activeRuntimeEvidenceStrategies(snapshot);
  for (const segment of [
    artifactId,
    deploymentId,
    ...strategies.map((s) => s.strategyName),
  ]) {
    if (
      !/^[A-Za-z0-9._:-]+$/.test(segment) ||
      segment === '.' ||
      segment === '..'
    )
      throw new Error('Invalid feedback output path identity');
  }
  const receiptPath = path.join(
    evidenceRoot,
    'receipts',
    deploymentId,
    `${artifactId}.json`,
  );
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  const lock = receiptPath + '.processing';
  await fs.mkdir(lock);
  try {
    const previous = await fs
      .readFile(receiptPath, 'utf8')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
    if (previous) {
      const receipt: unknown = JSON.parse(previous);
      if (
        !receipt ||
        typeof receipt !== 'object' ||
        !('schemaVersion' in receipt) ||
        receipt.schemaVersion !== 2 ||
        !('payloadSha256' in receipt) ||
        !('runtimeFeedbackArtifactId' in receipt) ||
        !('replayEvidenceSha256' in receipt) ||
        !('scorecardPath' in receipt) ||
        receipt.payloadSha256 !== runtimeEvidence.manifest.payload.sha256 ||
        receipt.runtimeFeedbackArtifactId !== feedback.manifest.artifactId ||
        receipt.replayEvidenceSha256 !==
          feedback.manifest.payloads.replayEvidence.sha256 ||
        typeof receipt.scorecardPath !== 'string'
      )
        throw new Error('Processing receipt conflicts with the exact pair');
      await fs.access(receipt.scorecardPath);
      return {
        processed: false,
        receiptPath,
        scorecardPath: receipt.scorecardPath,
      };
    }
    const history = [];
    if (historyDir)
      for (const directory of await discoverRuntimeEvidenceBundles(historyDir))
        history.push((await verifyRuntimeEvidenceBundle(directory)).artifact);
    const runId =
      new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID();
    const runDir = path.join(outputRoot, artifactId, runId);
    await fs.mkdir(runDir, { recursive: true });
    const calibration = buildExecutionCalibrationReport({
      runtimeArtifact: runtimeEvidence.artifact,
      replayEvidenceArtifact: feedback.replayEvidence,
    });
    await fs.writeFile(
      path.join(runDir, 'execution-calibration.json'),
      JSON.stringify(calibration, null, 2),
    );
    const inputs = {
      runtimeArtifact: runtimeEvidence.artifact,
      replayEvidenceArtifact: feedback.replayEvidence,
      calibrationArtifact: calibration,
      historyRuntimeArtifacts: history,
    };
    for (const strategy of [...strategies.map((s) => s.strategyName), null]) {
      const scorecard = buildRuntimeScorecard({ ...inputs, strategy });
      const base = path.join(
        runDir,
        strategy ? `runtime-scorecard-${strategy}` : 'runtime-scorecard',
      );
      await fs.writeFile(base + '.json', JSON.stringify(scorecard, null, 2));
      await fs.writeFile(
        base + '.md',
        formatRuntimeScorecardMarkdown(scorecard),
      );
    }
    await verifyRuntimeFeedbackReplaySource({
      bundleDir: replayDir,
      runtimeEvidenceBundleDir: runtimeDir,
    });
    const scorecardPath = path.join(runDir, 'runtime-scorecard.json');
    await markRuntimeEvidenceBundleProcessed({
      evidenceRoot,
      deploymentId,
      bundleDir: runtimeDir,
      scorecardPath,
      runtimeFeedback: {
        artifactId: feedback.manifest.artifactId,
        replayEvidenceSha256: feedback.manifest.payloads.replayEvidence.sha256,
      },
    });
    return { processed: true, receiptPath, scorecardPath };
  } finally {
    await fs.rmdir(lock);
  }
};
