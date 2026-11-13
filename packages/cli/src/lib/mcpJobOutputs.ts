import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDataStrict, mcpStorage, redisKeys } from '@tradejs/infra/redis';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
  verifyRuntimeFeedbackReplaySource,
} from '@tradejs/node/diagnostics';
import {
  isMcpRecord,
  mcpArtifactLocationId,
  mcpId,
  mcpJobDirectory,
  mcpProjectRoot,
  MCP_JOB_TTL,
} from '@tradejs/node/mcp';
import type { McpJob } from '@tradejs/types';
import { createTimestamp } from './runFormatting';

export const mcpBacktestResultTimestamp = (job: McpJob) =>
  createTimestamp(new Date(job.createdAt));

const collectEvidence = async (job: McpJob) =>
  Promise.all(
    (await discoverRuntimeEvidenceBundles(mcpJobDirectory(job))).map(
      async (bundleDir) => {
        const { manifest } = await verifyRuntimeEvidenceBundle(bundleDir);
        if (
          manifest.userName !== job.userName ||
          manifest.deploymentId !== job.request.deploymentId ||
          manifest.window.startTime !== job.request.startTime ||
          manifest.window.endTime !== job.request.endTime
        )
          throw new Error('Runtime evidence does not match the job');
        return {
          bundleDir,
          id: mcpId(`${manifest.artifactId}:${manifest.payload.sha256}`),
        };
      },
    ),
  );

const collectReplay = async (job: McpJob) => {
  const sourceDir = path.dirname(String(job.request.verifiedEvidencePath));
  const source = await verifyRuntimeEvidenceBundle(sourceDir);
  const { artifactId, deploymentId, userName, window } = source.manifest;
  if (
    userName !== job.userName ||
    deploymentId !== job.request.deploymentId ||
    (job.request.verifiedEvidenceSha256 !== undefined &&
      job.request.verifiedEvidenceSha256 !== source.manifest.payload.sha256) ||
    !/^[A-Za-z0-9._-]+$/.test(artifactId) ||
    !/^[A-Za-z0-9._-]+$/.test(deploymentId) ||
    ['.', '..'].includes(artifactId) ||
    ['.', '..'].includes(deploymentId)
  )
    throw new Error('Runtime evidence does not match the replay job');

  const root = path.join(mcpProjectRoot(), 'data/runtime-feedback');
  const receipt: unknown = JSON.parse(
    await readFile(
      path.join(root, 'completed', deploymentId, `${artifactId}.json`),
      'utf8',
    ),
  );
  if (
    !isMcpRecord(receipt) ||
    receipt.schemaVersion !== 1 ||
    receipt.runtimeEvidenceArtifactId !== artifactId ||
    typeof receipt.runtimeFeedbackBundle !== 'string'
  )
    throw new Error('Invalid replay completion receipt');

  // Deploy writes a host path. Resolve its run name under the shared data mount.
  const runId = path.basename(receipt.runtimeFeedbackBundle);
  if (!/^[A-Za-z0-9_-]+$/.test(runId))
    throw new Error('Invalid replay bundle name');
  const day = new Date(window.endTime).toISOString().slice(0, 10).split('-');
  const bundleDir = path.join(
    root,
    'ready',
    deploymentId,
    ...day,
    artifactId,
    runId,
  );
  const { feedback } = await verifyRuntimeFeedbackReplaySource({
    bundleDir,
    runtimeEvidenceBundleDir: sourceDir,
  });
  const { manifest } = feedback;
  return [
    {
      bundleDir,
      id: mcpId(
        `${manifest.artifactId}:${manifest.payloads.replayEvidence.sha256}`,
      ),
    },
  ];
};

export const collectMcpJobOutputs = async (
  job: McpJob,
): Promise<Pick<McpJob, 'resultId' | 'artifactIds'>> => {
  if (job.kind === 'backtest') {
    const config = job.request.frozenConfigId;
    if (typeof config !== 'string')
      throw new Error('Invalid frozen backtest config');
    const timestamp = mcpBacktestResultTimestamp(job);
    if (
      !(await getDataStrict(
        redisKeys.backtestResults(job.userName, config, timestamp),
      ))
    )
      throw new Error('Backtest result was not saved');
    return { resultId: `${config}:${timestamp}` };
  }
  const bundles =
    job.kind === 'runtime-evidence'
      ? await collectEvidence(job)
      : await collectReplay(job);
  if (!bundles.length)
    throw new Error('No verified diagnostic report was saved');
  for (const { id, bundleDir } of bundles) {
    if (
      !(await mcpStorage.put(
        mcpArtifactLocationId(job.userName, id),
        bundleDir,
        MCP_JOB_TTL,
      ))
    )
      throw new Error('Diagnostic report location could not be saved');
  }
  return { artifactIds: bundles.map(({ id }) => id) };
};
