import { after } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import {
  listDataCoverageDatasets,
  readDataBackfillSlots,
  resolveDataBackfill,
} from '@tradejs/infra/timescale/dataCoverage';
import type { DataBackfillRequest, DataBackfillJob } from '@tradejs/types';
import { z } from 'zod';
import {
  drainDataBackfillQueue,
  enqueueDataBackfill,
  listDataBackfillJobs,
} from '../dataBackfillQueue';

const dayMs = 86_400_000;
export const coverageTarget = {
  dataset: z.string().min(1).max(100),
  series: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

type Input = z.output<z.ZodObject<typeof coverageTarget>>;

function parseTarget({ dataset, series, date }: Input, days = 1) {
  const from = Date.parse(date);
  if (
    !Number.isFinite(from) ||
    new Date(from).toISOString().slice(0, 10) !== date
  )
    throw new Error('Provide a valid UTC date (YYYY-MM-DD).');
  const requests = Array.from(
    { length: days },
    (_, index): DataBackfillRequest => ({
      dataset,
      series,
      day: from + index * dayMs,
    }),
  );
  if (!requests.every(resolveDataBackfill))
    throw new Error(
      'Provide a supported dataset and series with a UTC date that has closed intervals. Use coverage_list_datasets.',
    );
  return requests;
}

function observation(missing: number, loaded: number, job?: DataBackfillJob) {
  if (!missing) return 'complete';
  if (job?.status === 'failed') return 'backfill_failed';
  if (job?.status === 'queued' || job?.status === 'running')
    return 'backfill_pending';
  if (job?.status === 'partial') return 'backfill_finished_with_gaps';
  return loaded ? 'missing_local_intervals' : 'no_local_samples';
}

export const listCoverageDatasets = () => listDataCoverageDatasets();

const outcomeEvidence = {
  no_matching_market:
    'Coinalyze returned no matching USDT perpetual market for this series.',
  historical_basket_unavailable:
    'This historical Binance basket is absent from the current project catalog.',
  outside_configured_history:
    'The UTC day precedes the configured CoinMarketCap history window.',
  no_missing_slots_filled:
    'The loader did not add any missing slots. This alone does not identify the provider-side cause.',
  some_missing_slots_filled:
    'The loader filled part of the gap. Some expected slots are still missing locally.',
};

export async function inspectCoverage(
  user: string,
  input: Input & { days: number },
) {
  const requests = parseTarget(input, input.days);
  const jobs = await listDataBackfillJobs(user);
  const rows = [];
  for (const request of requests) {
    const { dataset, end } = resolveDataBackfill(request)!;
    const { loaded, expected } = await readDataBackfillSlots(request, end);
    const missingTimes = [];
    for (let slot = request.day; slot < end; slot += dataset.stepMs) {
      if (!loaded.has(slot)) missingTimes.push(slot);
    }
    const job = jobs.find(
      (item) =>
        item.dataset === request.dataset &&
        item.series === request.series &&
        item.day === request.day,
    );
    const outcome = job?.result?.outcome;
    rows.push({
      date: new Date(request.day).toISOString().slice(0, 10),
      endExclusive: end,
      expected,
      loaded: loaded.size,
      missing: missingTimes.length,
      missingTimes,
      observation: observation(missingTimes.length, loaded.size, job),
      lastBackfill: job ?? null,
      backfillEvidence: outcome ? outcomeEvidence[outcome] : null,
    });
  }
  return {
    dataset: input.dataset,
    series: input.series,
    days: rows,
    timeUnit: 'UTC milliseconds',
    evidence:
      'Local TimescaleDB and shared backfill history. Missing samples alone do not establish provider availability, listing dates, or why ingestion was missed. A partial job confirms gaps remained after that attempt.',
  };
}

export function scheduleCoverageBackfill(user: string) {
  after(async () => {
    try {
      await drainDataBackfillQueue(user);
    } catch (error) {
      logger.error('Data backfill queue worker failed: %o', error);
    }
  });
}

export async function startCoverageBackfill(
  user: string,
  input: Input,
  retry: boolean,
) {
  const [request] = parseTarget(input);
  const job = await enqueueDataBackfill(user, request, { retry });
  if (job.status === 'queued' || job.status === 'running')
    scheduleCoverageBackfill(user);
  return job;
}

export async function getCoverageBackfill(
  user: string,
  jobId: string,
  canRun: boolean,
) {
  const job = (await listDataBackfillJobs(user)).find(
    (item) => item.id === jobId,
  );
  if (!job) throw new Error('Job not found.');
  if (canRun && (job.status === 'queued' || job.status === 'running'))
    scheduleCoverageBackfill(user);
  return job;
}
