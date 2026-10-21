import path from 'node:path';
import { parseRuntimeEvidenceProducer } from './runtimeEvidenceProducer';
import { verifyRuntimeEvidenceBundle } from './runtimeEvidenceArtifacts';

// Docker host paths must be configured explicitly; container paths are not host paths.
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
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId))
    throw new Error('Invalid replay container run id');
  const bundle = await verifyRuntimeEvidenceBundle(path.dirname(evidencePath));
  if (path.resolve(evidencePath) !== path.resolve(bundle.payloadPath))
    throw new Error('Replay requires the verified bundle payload');
  const producer = parseRuntimeEvidenceProducer(bundle.artifact.producer);
  if (
    !env.MCP_REPLAY_HOST_PROJECT_ROOT ||
    !env.MCP_REPLAY_NETWORK ||
    !env.MCP_REPLAY_IMAGE_REPOSITORY
  )
    throw new Error(
      'Image-bound replay requires MCP_REPLAY_HOST_PROJECT_ROOT MCP_REPLAY_NETWORK and MCP_REPLAY_IMAGE_REPOSITORY',
    );
  const hostPath = (file: string) => {
    const relative = path.relative(projectRoot, file);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Replay mounts must be inside the Project');
    return path.join(env.MCP_REPLAY_HOST_PROJECT_ROOT!, relative);
  };
  const args = [
    'run',
    '--rm',
    '--name',
    `tradejs-replay-${runId}`,
    '--memory=1536m',
    '--cpus=1',
    '--pids-limit=512',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--network',
    env.MCP_REPLAY_NETWORK,
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/app/data',
    '--entrypoint',
    '/app/node_modules/.bin/tradejs',
    '--mount',
    `type=bind,src=${hostPath(path.dirname(evidencePath))},dst=/evidence,readonly`,
    '--mount',
    `type=bind,src=${hostPath(outDir)},dst=/replay-output`,
  ];
  const safeEnv: NodeJS.ProcessEnv = {
    PROJECT_CWD: '/app',
    DOTENV_CONFIG_PATH: '/dev/null',
    TRADEJS_PROJECT_SHA: producer.projectSha,
    TRADEJS_PROJECT_IMAGE_DIGEST: producer.imageDigest,
    NODE_OPTIONS: '--max-old-space-size=1024',
    MAKE_ORDERS: 'false',
    TRADEJS_EXTERNAL_ORDER_PLACEMENT: 'false',
    AI_ENABLED: 'false',
    ML_ENABLED: 'false',
    RUNTIME_FEEDBACK_ISOLATED_REDIS: 'true',
    REDIS_HOST: env.MCP_REPLAY_REDIS_HOST,
    REDIS_PORT: '6379',
    REDIS_DB: '0',
    PGOPTIONS: '-c default_transaction_read_only=on',
    TRADEJS_TIMESCALE_READ_ONLY: 'true',
  };
  for (const name of ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_DATABASE', 'PG_DB'])
    if (env[name]) safeEnv[name] = env[name];
  for (const [name, value] of Object.entries(safeEnv))
    if (value !== undefined) args.push('--env', `${name}=${value}`);
  if (env.PG_PASSWORD) args.push('--env', 'PG_PASSWORD');
  args.push(
    `${env.MCP_REPLAY_IMAGE_REPOSITORY}@${producer.imageDigest}`,
    'runtime-feedback-replay',
    '--runtimeEvidence',
    `/evidence/${path.basename(evidencePath)}`,
    '--outDir',
    '/replay-output',
    '--runId',
    runId,
  );
  return { executable: 'docker', args };
};
