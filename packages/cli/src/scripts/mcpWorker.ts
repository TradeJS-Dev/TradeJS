import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { mcpStorage, redisKeys, setDataStrict } from '@tradejs/infra/redis';
import {
  mcpJobDirectory,
  mcpJobStorageId,
  mcpPackageManifestHash,
  MCP_JOB_TTL,
} from '@tradejs/node/mcp';
import type { McpJob } from '@tradejs/types';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const leaseKey = 'worker:lease';
const LEASE_SECONDS = 15;
const JOB_TIMEOUT_MS = 60 * 60 * 1000;

export const main = async (options: { signal?: AbortSignal } = {}) => {
  const owner = randomUUID();
  if (!(await mcpStorage.put(leaseKey, owner, LEASE_SECONDS, true)))
    throw new Error('Another MCP worker owns this storage');
  let stopping = false;
  let child: ChildProcess | undefined;
  let renewing = false;
  let leaseLost = false;
  let manifestHash = '';
  const signalChild = (signal: NodeJS.Signals) => {
    if (!child?.pid) return;
    try {
      process.kill(
        process.platform === 'win32' ? child.pid : -child.pid,
        signal,
      );
    } catch {
      /* Child already exited. */
    }
  };
  const heartbeatValue = () => ({
    observedAt: Date.now(),
    packageManifestSha256: manifestHash,
    replayAvailable: Boolean(process.env.MCP_REPLAY_REDIS_HOST),
  });
  const stop = () => {
    stopping = true;
    signalChild('SIGTERM');
  };
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const heartbeat = setInterval(async () => {
    if (renewing || leaseLost) return;
    renewing = true;
    try {
      if (!(await mcpStorage.compare(leaseKey, owner, owner, LEASE_SECONDS)))
        throw new Error('Worker lease lost');
      await mcpStorage.put('worker:heartbeat', heartbeatValue(), LEASE_SECONDS);
    } catch {
      leaseLost = true;
      stop();
    } finally {
      renewing = false;
    }
  }, 2000);

  try {
    manifestHash = await mcpPackageManifestHash();
    await mcpStorage.put('worker:heartbeat', heartbeatValue(), LEASE_SECONDS);
    let cursor = '0';
    do {
      const page = await mcpStorage.scan('jobs:', cursor);
      cursor = page.cursor;
      for (const key of page.ids) {
        const job = await mcpStorage.get<McpJob>(key);
        if (job?.status === 'running')
          await mcpStorage.compare(
            key,
            job,
            {
              ...job,
              status: 'failed',
              error: 'Worker restarted; this job was not replayed',
              finishedAt: Date.now(),
              updatedAt: Date.now(),
            },
            MCP_JOB_TTL,
          );
      }
    } while (cursor !== '0' && !stopping);

    console.log(
      'MCP worker ready (one job at a time, cached history, no live order commands)',
    );
    while (!stopping) {
      let queued: McpJob | undefined;
      cursor = '0';
      do {
        const page = await mcpStorage.scan('jobs:', cursor);
        cursor = page.cursor;
        for (const key of page.ids) {
          const job = await mcpStorage.get<McpJob>(key);
          if (
            job?.status === 'queued' &&
            (!queued || job.createdAt < queued.createdAt)
          )
            queued = job;
        }
      } while (cursor !== '0' && !stopping);
      if (!queued) {
        await pause(1000);
        continue;
      }
      const jobKey = mcpJobStorageId(queued.userName, queued.id);
      const started: McpJob = {
        ...queued,
        status: 'running',
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (!(await mcpStorage.compare(jobKey, queued, started, MCP_JOB_TTL)))
        continue;
      if (started.packageManifestSha256 !== manifestHash) {
        await mcpStorage.compare(
          jobKey,
          started,
          {
            ...started,
            status: 'failed',
            error: 'Package composition changed since submission',
            finishedAt: Date.now(),
          },
          MCP_JOB_TTL,
        );
        continue;
      }
      await mkdir(mcpJobDirectory(started), { recursive: true });
      if (started.kind === 'backtest')
        await setDataStrict(
          redisKeys.backtestConfig(
            started.userName,
            String(started.request.frozenConfigId),
          ),
          started.request.resolvedConfig,
          { expire: MCP_JOB_TTL },
        );
      const jobEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=1024',
        MCP_WORKER: 'true',
        BACKTEST_WORKER_HEAP_MB: '768',
        BACKTEST_MAX_PARALLEL: '1',
        AI_ENABLED: 'false',
        ML_ENABLED: 'false',
        MAKE_ORDERS: 'false',
        TRADEJS_EXTERNAL_ORDER_PLACEMENT: 'false',
      };
      if (started.kind === 'runtime-feedback-replay') {
        for (const name of Object.keys(jobEnv)) {
          if (
            /secret|token|api.?key|private.?key|cookie|credential/i.test(name)
          )
            delete jobEnv[name as keyof typeof jobEnv];
        }
        Object.assign(jobEnv, {
          DOTENV_CONFIG_PATH: '/dev/null',
          REDIS_HOST: process.env.MCP_REPLAY_REDIS_HOST,
          REDIS_PORT: '6379',
          REDIS_DB: '0',
          RUNTIME_FEEDBACK_ISOLATED_REDIS: 'true',
          PGOPTIONS: '-c default_transaction_read_only=on',
          TRADEJS_TIMESCALE_READ_ONLY: 'true',
        });
      }
      child = spawn(process.execPath, [process.argv[1], ...started.args], {
        cwd: process.env.PROJECT_CWD || process.cwd(),
        env: jobEnv,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const currentChild = child;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        signalChild('SIGTERM');
      }, JOB_TIMEOUT_MS);
      const logs: string[] = [];
      const log = (chunk: Buffer) => {
        const lines = chunk
          .toString()
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split(/[\r\n]+/)
          .filter(Boolean);
        logs.push(
          ...lines.map((line) =>
            line
              .slice(0, 1000)
              .replace(
                /((?:secret|password|api.?key|token|authorization)\s*[:=]\s*)\S+/gi,
                '$1[redacted]',
              ),
          ),
        );
        if (logs.length > 150) logs.splice(0, logs.length - 150);
      };
      currentChild.stdout?.on('data', log);
      currentChild.stderr?.on('data', log);
      let killAt: number | undefined;
      const monitor = setInterval(async () => {
        try {
          const latest = await mcpStorage.get<McpJob>(jobKey);
          if (!latest || latest.cancelRequested || stopping || timedOut) {
            killAt ??= Date.now();
            signalChild(Date.now() - killAt > 8000 ? 'SIGKILL' : 'SIGTERM');
          }
          if (latest && !leaseLost)
            await mcpStorage.compare(
              jobKey,
              latest,
              { ...latest, logs: [...logs], updatedAt: Date.now() },
              MCP_JOB_TTL,
            );
        } catch {
          leaseLost = true;
          stop();
        }
      }, 1000);
      const outcome = await new Promise<{
        code: number | null;
        error?: string;
      }>((resolve) => {
        currentChild.once('error', () =>
          resolve({ code: null, error: 'Unable to start research process' }),
        );
        currentChild.once('exit', (code) => resolve({ code }));
      });
      clearTimeout(timeout);
      clearInterval(monitor);
      child = undefined;
      if (!leaseLost) {
        // Retry CAS if a concurrent cancellation arrived during finalization.
        for (let attempt = 0; attempt < 4; attempt++) {
          const latest = await mcpStorage.get<McpJob>(jobKey);
          if (!latest) break;
          const cancelled = latest.cancelRequested;
          const next: McpJob = {
            ...latest,
            logs,
            status: cancelled
              ? 'cancelled'
              : outcome.code === 0 && !timedOut && !stopping
                ? 'completed'
                : 'failed',
            exitCode: outcome.code,
            updatedAt: Date.now(),
            finishedAt: Date.now(),
            ...(cancelled
              ? {}
              : timedOut
                ? { error: 'Job exceeded one hour' }
                : stopping
                  ? { error: 'Worker stopped; this job was not replayed' }
                  : outcome.code !== 0
                    ? { error: outcome.error || 'Research process failed' }
                    : {}),
          };
          if (await mcpStorage.compare(jobKey, latest, next, MCP_JOB_TTL))
            break;
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
    options.signal?.removeEventListener('abort', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (await mcpStorage.release(leaseKey, owner))
      await mcpStorage.remove('worker:heartbeat');
  }
  if (leaseLost)
    throw new Error('Worker lease lost; active computation was stopped');
};
