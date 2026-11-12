import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import {
  getDataCoveragePeriodEnd,
  isDataCoverageDataset,
} from '@tradejs/infra/timescale/dataCoverage';
import { getCachedDataCoverage } from '#app/lib/dataCoverageCache';
import { getCurrentUserName } from '#app/lib/currentUser';
import { INSTALL_USER_NAME } from '#app/lib/installation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAY_MS = 86_400_000;
const reply = (body: unknown, status = 200, cacheStatus?: string) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      ...(cacheStatus && { 'X-Data-Coverage-Cache': cacheStatus }),
    },
  });

export async function GET(request: NextRequest) {
  const user = await getCurrentUserName();
  if (user !== INSTALL_USER_NAME)
    return reply({ error: 'Access denied.' }, user ? 403 : 401);

  const query = request.nextUrl.searchParams;
  const id = query.get('dataset') ?? '';
  const to = Number(query.get('to'));
  const from = to - 30 * DAY_MS;
  const tomorrow = getDataCoveragePeriodEnd();
  const day = query.has('day') ? Number(query.get('day')) : undefined;
  if (
    !isDataCoverageDataset(id) ||
    !Number.isSafeInteger(to) ||
    to % DAY_MS !== 0 ||
    from < 0 ||
    to > tomorrow ||
    (day !== undefined &&
      (!Number.isSafeInteger(day) ||
        day % DAY_MS !== 0 ||
        day < from ||
        day >= to))
  ) {
    return reply({ error: 'Invalid dataset or time range.' }, 400);
  }

  try {
    request.signal.throwIfAborted();
    const { result, status } = getCachedDataCoverage({
      dataset: id,
      period: { from, to },
      day,
      refresh: day === undefined && query.get('refresh') === '1',
    });
    return reply(await result, 200, status);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('Could not read market data coverage: %o', error);
    return reply({ error: 'Could not read data from TimescaleDB.' }, 500);
  }
}
