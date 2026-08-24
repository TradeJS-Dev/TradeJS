import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseRuntimeEvidenceDeploymentSnapshot,
  activeRuntimeEvidenceStrategies,
} from './runtimeEvidenceDeployment';
import { verifyRuntimeEvidenceBundle } from './runtimeEvidenceArtifacts';
import {
  parseRuntimeEvidenceProducer,
  resolveRuntimeEvidenceProducer,
} from './runtimeEvidenceProducer';
import {
  RUNTIME_FEEDBACK_LOG_FILE,
  RUNTIME_FEEDBACK_REPLAY_FILE,
  sealRuntimeFeedbackReplayBundle,
} from './runtimeFeedbackArtifacts';

const REQUIRED_ENV = {
  RUNTIME_FEEDBACK_ISOLATED_REDIS: 'true',
  MAKE_ORDERS: 'false',
  TRADEJS_EXTERNAL_ORDER_PLACEMENT: 'false',
} as const;

const FORBIDDEN_SECRET_ENV = [
  'AGENT_GITHUB_TOKEN',
  'AI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AUTH_SECRET',
  'BYBIT_API_KEY',
  'BYBIT_API_SECRET',
  'COINALYZE_API_KEY',
  'COINMARKETCAP_API_KEY',
  'GITHUB_TOKEN',
  'GIT_SSH_PRIVATE_KEY',
  'NEXTAUTH_SECRET',
  'NPM_TOKEN',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'SSH_PRIVATE_KEY',
  'TG_BOT_TOKEN',
] as const;

const unsafeRedisHosts = new Set([
  '127.0.0.1',
  '::1',
  'inv-redis',
  'localhost',
  'redis',
]);

const safeSegment = (value: string, fallback: string) => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized && normalized !== '.' && normalized !== '..'
    ? normalized
    : fallback;
};

export const assertRuntimeFeedbackReplaySafety = (env: NodeJS.ProcessEnv) => {
  for (const [name, expected] of Object.entries(REQUIRED_ENV)) {
    if (env[name] !== expected) {
      throw new Error(`Runtime feedback replay requires ${name}=${expected}`);
    }
  }

  const redisHost = String(env.REDIS_HOST ?? '')
    .trim()
    .toLowerCase();
  if (!redisHost || unsafeRedisHosts.has(redisHost)) {
    throw new Error(
      `Runtime feedback replay requires a named isolated Redis host, received ${redisHost || '[missing]'}`,
    );
  }

  const pgOptions = String(env.PGOPTIONS ?? '');
  if (!/default_transaction_read_only\s*=\s*on/i.test(pgOptions)) {
    throw new Error(
      'Runtime feedback replay requires PGOPTIONS with default_transaction_read_only=on',
    );
  }
  if (env.TRADEJS_TIMESCALE_READ_ONLY !== 'true') {
    throw new Error(
      'Runtime feedback replay requires TRADEJS_TIMESCALE_READ_ONLY=true',
    );
  }

  const exposedSecrets = FORBIDDEN_SECRET_ENV.filter((name) =>
    String(env[name] ?? '').trim(),
  );
  if (exposedSecrets.length) {
    throw new Error(
      `Runtime feedback replay received forbidden credentials: ${exposedSecrets.join(', ')}`,
    );
  }
};

export const buildRuntimeFeedbackReplayCommands = ({
  cliPath,
  runtimeEvidencePath,
  replayEvidencePath,
  userName,
  connectorName,
  deploymentId,
  interval,
  startTime,
  endTime,
}: {
  cliPath: string;
  runtimeEvidencePath: string;
  replayEvidencePath: string;
  userName: string;
  connectorName: string;
  deploymentId: string;
  interval: string;
  startTime: number;
  endTime: number;
}) =>
  [
    [
      cliPath,
      'replay',
      '--user',
      userName,
      '--connector',
      connectorName,
      '--deployment',
      deploymentId,
      '--timeframe',
      interval,
      '--startTime',
      String(startTime),
      '--endTime',
      String(endTime),
      '--runtimeEvidence',
      runtimeEvidencePath,
      '--cacheOnly',
    ],
    [
      cliPath,
      'replay-runtime-evidence',
      '--user',
      userName,
      '--runtimeEvidence',
      runtimeEvidencePath,
      '--startTime',
      String(startTime),
      '--endTime',
      String(endTime),
      '--out',
      replayEvidencePath,
    ],
  ] as const;

const runLoggedCommand = async ({
  executable,
  command,
  cwd,
  env,
  logHandle,
}: {
  executable: string;
  command: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logHandle: fs.FileHandle;
}) => {
  await logHandle.write(`\n$ ${[executable, ...command].join(' ')}\n`);
  await new Promise<void>((resolve, reject) => {
    let pendingLogWrite = Promise.resolve();
    const appendLog = (chunk: Buffer) => {
      pendingLogWrite = pendingLogWrite.then(async () => {
        await logHandle.write(chunk);
      });
    };
    const child = spawn(executable, command, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      appendLog(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      appendLog(chunk);
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      void pendingLogWrite.then(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `Runtime feedback command failed: exit=${String(code)} signal=${String(signal)}`,
          ),
        );
      }, reject);
    });
  });
};

export const runRuntimeFeedbackReplay = async ({
  runtimeEvidencePath,
  outDir,
  runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`,
  projectRoot,
  env = process.env,
  executable = process.execPath,
  cliPath = process.argv[1],
}: {
  runtimeEvidencePath: string;
  outDir: string;
  runId?: string;
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  executable?: string;
  cliPath?: string;
}) => {
  assertRuntimeFeedbackReplaySafety(env);
  if (!cliPath) {
    throw new Error('Cannot resolve the TradeJS CLI executable path');
  }

  const runtimeEvidenceBundle = await verifyRuntimeEvidenceBundle(
    path.dirname(runtimeEvidencePath),
  );
  if (path.resolve(runtimeEvidenceBundle.payloadPath) !== runtimeEvidencePath) {
    throw new Error(
      `Runtime evidence must be the verified bundle payload: ${runtimeEvidenceBundle.payloadPath}`,
    );
  }
  const deployedProducer = parseRuntimeEvidenceProducer(
    runtimeEvidenceBundle.artifact.producer,
  );
  const currentProducer = await resolveRuntimeEvidenceProducer({
    projectRoot,
    required: true,
  });
  if (
    !currentProducer ||
    currentProducer.projectSha !== deployedProducer.projectSha ||
    currentProducer.imageDigest !== deployedProducer.imageDigest ||
    currentProducer.runtimePackageManifest.sha256 !==
      deployedProducer.runtimePackageManifest.sha256
  ) {
    throw new Error(
      'Runtime feedback replay image identity does not match runtime evidence',
    );
  }

  const deployment = parseRuntimeEvidenceDeploymentSnapshot(
    runtimeEvidenceBundle.artifact.deployment,
  );
  const activeStrategies = activeRuntimeEvidenceStrategies(deployment);
  const intervals = new Set(
    activeStrategies.map(({ interval }) => String(interval)),
  );
  if (intervals.size !== 1) {
    throw new Error(
      `Runtime feedback replay requires one interval, received ${[...intervals].join(',')}`,
    );
  }

  await fs.mkdir(outDir, { recursive: true });
  const existing = await fs.readdir(outDir);
  if (existing.length) {
    throw new Error(
      `Runtime feedback output directory must be empty: ${outDir}`,
    );
  }

  const replayEvidencePath = path.join(outDir, RUNTIME_FEEDBACK_REPLAY_FILE);
  const logHandle = await fs.open(
    path.join(outDir, RUNTIME_FEEDBACK_LOG_FILE),
    'wx',
  );
  const commands = buildRuntimeFeedbackReplayCommands({
    cliPath,
    runtimeEvidencePath,
    replayEvidencePath,
    userName: runtimeEvidenceBundle.manifest.userName,
    connectorName: deployment.connectorName,
    deploymentId: deployment.id,
    interval: [...intervals][0],
    startTime: runtimeEvidenceBundle.manifest.window.startTime,
    endTime: runtimeEvidenceBundle.manifest.window.endTime,
  });

  try {
    for (const command of commands) {
      await runLoggedCommand({
        executable,
        command,
        cwd: projectRoot,
        env,
        logHandle,
      });
    }
  } finally {
    await logHandle.close();
  }

  return sealRuntimeFeedbackReplayBundle({
    bundleDir: outDir,
    runId: safeSegment(runId, 'run'),
    runtimeEvidenceBundle,
  });
};
