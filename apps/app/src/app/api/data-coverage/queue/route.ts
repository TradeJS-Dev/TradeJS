import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { logger } from '@tradejs/infra/logger';
import { resolveDataBackfill } from '@tradejs/infra/timescale/dataCoverage';
import { getCurrentUserName } from '#app/lib/currentUser';
import { INSTALL_USER_NAME } from '#app/lib/installation';
import {
  drainDataBackfillQueue,
  enqueueDataBackfill,
  listDataBackfillJobs,
} from '#app/lib/dataBackfillQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const requestSchema = z
  .object({
    dataset: z.string().max(100),
    series: z.string().max(100),
    day: z.number().int(),
  })
  .strict();

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });

function schedule(user: string) {
  after(async () => {
    try {
      await drainDataBackfillQueue(user);
    } catch (error) {
      logger.error('Data backfill queue worker failed: %o', error);
    }
  });
}

export async function GET() {
  const user = await getCurrentUserName();
  if (user !== INSTALL_USER_NAME)
    return reply({ error: 'Access denied.' }, user ? 403 : 401);
  try {
    const jobs = await listDataBackfillJobs(user);
    if (jobs.some((job) => job.status === 'queued' || job.status === 'running'))
      schedule(user);
    return reply(jobs);
  } catch {
    return reply({ error: 'The backfill queue is unavailable.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUserName();
  if (user !== INSTALL_USER_NAME)
    return reply({ error: 'Access denied.' }, user ? 403 : 401);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return reply({ error: 'Expected JSON.' }, 415);
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success || !resolveDataBackfill(input.data))
    return reply({ error: 'Invalid data backfill target.' }, 400);
  try {
    const job = await enqueueDataBackfill(user, input.data);
    schedule(user);
    return reply(job, 202);
  } catch {
    return reply(
      { error: 'Could not queue the backfill. Check the queue and try again.' },
      503,
    );
  }
}
