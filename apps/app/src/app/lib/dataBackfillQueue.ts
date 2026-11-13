import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { mcpStorage } from '@tradejs/infra/redis';
import type {
  DataBackfillJob,
  DataBackfillRequest,
  DataBackfillResult,
} from '@tradejs/types';
import { invalidateDataCoverage } from './dataCoverageCache';

type Entry = DataBackfillJob & { startedAt?: number };
const ttl = 30 * 24 * 60 * 60;
const timeout = 5 * 60_000;
const key = (user: string) => `data-backfill:${user}`;

async function changeQueue<T>(
  user: string,
  update: (jobs: Entry[]) => { jobs?: Entry[]; value: T },
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const previous = await mcpStorage.get<Entry[]>(key(user));
    const { jobs, value } = update(previous ?? []);
    if (!jobs) return value;
    const saved = previous
      ? await mcpStorage.compare(key(user), previous, jobs, ttl)
      : await mcpStorage.put(key(user), jobs, ttl, true);
    if (saved) return value;
  }
  throw new Error('The queue is busy. Try again.');
}

export const listDataBackfillJobs = async (user: string) =>
  ((await mcpStorage.get<Entry[]>(key(user))) ?? []).toReversed();

export async function enqueueDataBackfill(
  user: string,
  request: DataBackfillRequest,
) {
  const id = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  return changeQueue(user, (jobs) => {
    const previous = jobs.find((job) => job.id === id);
    if (
      previous &&
      ['queued', 'running', 'completed'].includes(previous.status)
    )
      return { value: previous };
    const pending = jobs.filter(
      (job) => job.status === 'queued' || job.status === 'running',
    );
    if (pending.length >= 40)
      throw new Error('The queue has 40 pending jobs. Wait for one to finish.');
    const history = jobs
      .filter((job) => job.id !== id && !pending.includes(job))
      .slice(-59);
    const job: Entry = {
      ...request,
      id,
      status: 'queued',
      createdAt: Date.now(),
    };
    return { jobs: [...history, ...pending, job], value: job };
  });
}

async function runBackfill(
  user: string,
  job: Entry,
): Promise<DataBackfillResult> {
  const project = process.env.PROJECT_CWD?.trim() || process.cwd();
  const checkout = path.resolve(
    process.cwd(),
    '../../packages/cli/dist/cli.js',
  );
  const installed = path.join(
    project,
    'node_modules',
    '@tradejs',
    'cli',
    'dist',
    'cli.js',
  );
  const entry =
    process.env.TRADEJS_CLI_ENTRYPOINT ||
    (existsSync(checkout) ? checkout : installed);
  if (!existsSync(entry))
    throw new Error('Build or install the TradeJS CLI to run backfills.');
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [
        entry,
        'coverage:backfill',
        user,
        job.dataset,
        job.series,
        String(job.day),
      ],
      { cwd: project, timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      (error, output) => {
        if (error)
          reject(
            new Error(
              'The backfill failed. Check provider access and the installed TradeJS CLI before retrying.',
            ),
          );
        else resolve(output);
      },
    );
  });
  const marker = 'TRADEJS_DATA_BACKFILL ';
  const result = stdout.split('\n').findLast((line) => line.startsWith(marker));
  if (!result)
    throw new Error('The TradeJS CLI did not return a backfill result.');
  return JSON.parse(result.slice(marker.length)) as DataBackfillResult;
}

export async function drainDataBackfillQueue(user: string) {
  for (;;) {
    const current = await changeQueue<Entry | undefined>(user, (jobs) => {
      const now = Date.now();
      if (
        jobs.some(
          (job) =>
            job.status === 'running' &&
            now - (job.startedAt ?? 0) < timeout + 30_000,
        )
      )
        return { value: undefined };
      const next = jobs.find((job) => job.status === 'queued');
      const interrupted = jobs.some((job) => job.status === 'running');
      if (!next && !interrupted) return { value: undefined };
      const active: Entry | undefined = next && {
        ...next,
        status: 'running',
        startedAt: now,
      };
      return {
        value: active,
        jobs: jobs.map((job) =>
          job === next && active
            ? active
            : job.status === 'running'
              ? {
                  ...job,
                  status: 'failed',
                  error:
                    'The worker stopped before reporting a result. Retry this job.',
                }
              : job,
        ),
      };
    });
    if (!current) return;
    let finished: Entry;
    try {
      const result = await runBackfill(user, current);
      finished = {
        ...current,
        result,
        status: result.missing ? 'partial' : 'completed',
      };
      invalidateDataCoverage(current.dataset, current.day);
    } catch (error) {
      finished = {
        ...current,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Backfill failed.',
      };
    }
    await changeQueue(user, (jobs) => ({
      jobs: jobs.map((job) =>
        job.id === current.id &&
        job.status === 'running' &&
        job.startedAt === current.startedAt
          ? finished
          : job,
      ),
      value: undefined,
    }));
  }
}
