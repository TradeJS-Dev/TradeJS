import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { verifyRuntimeEvidenceBundle } from './runtimeEvidenceArtifacts';

// This child only exchanges sealed requests with the Deploy-owned host runner.
const client = `
const fs = require('node:fs');
const path = require('node:path');
const [root, id, request] = process.argv.slice(1);
const file = path.join(root, id);
fs.mkdirSync(root, {recursive:true});
const temporary = file + '.request.tmp-' + process.pid;
fs.writeFileSync(temporary, request, {flag:'wx'});
try { fs.linkSync(temporary, file + '.request'); }
catch (error) { if (error.code !== 'EEXIST') throw error; if (fs.readFileSync(file + '.request', 'utf8') !== request) throw new Error('Replay request identity conflict'); }
finally { fs.unlinkSync(temporary); }
process.on('SIGTERM', () => { fs.writeFileSync(file + '.cancel', 'cancel'); process.exit(143); });
const timer = setInterval(() => {
  try {
    const result = JSON.parse(fs.readFileSync(file + '.result', 'utf8'));
    console.log(result.message);
    clearInterval(timer);
    process.exit(result.exitCode === 0 ? 0 : 1);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}, 1000);
`;

export const buildMcpReplayProcess = async ({
  evidencePath,
  outDir,
  runId,
  projectRoot,
  env,
}: {
  evidencePath: string;
  outDir: string;
  runId: string;
  projectRoot: string;
  env: NodeJS.ProcessEnv;
}) => {
  if (!/^[a-f0-9]{64}$/.test(runId))
    throw new Error('Invalid replay request id');
  const bundle = await verifyRuntimeEvidenceBundle(path.dirname(evidencePath));
  if (path.resolve(evidencePath) !== path.resolve(bundle.payloadPath))
    throw new Error('Replay requires the verified bundle payload');
  const relative = path.relative(path.join(projectRoot, 'data'), evidencePath);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Evidence must be inside Project data');
  const root =
    env.MCP_REPLAY_REQUEST_ROOT ||
    path.join(projectRoot, 'data/mcp-replay-requests');
  const heartbeat = JSON.parse(
    await fs.readFile(path.join(root, 'heartbeat.json'), 'utf8'),
  );
  if (
    !Number.isFinite(heartbeat.observedAt) ||
    Date.now() - heartbeat.observedAt < 0 ||
    Date.now() - heartbeat.observedAt > 120000
  )
    throw new Error('Host replay runner heartbeat is stale');
  const bytes = await fs.readFile(evidencePath);
  const request = JSON.stringify({
    schemaVersion: 1,
    id: runId,
    evidence: relative,
    artifactId: bundle.manifest.artifactId,
    deploymentId: bundle.manifest.deploymentId,
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
  });
  void outDir;
  return {
    executable: process.execPath,
    args: ['-e', client, root, runId, request],
  };
};
