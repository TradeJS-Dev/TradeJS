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
  const tomorrow = getDataCoveragePeriodEnd();
  const yearParam = query.get('year');
  const year = Number(yearParam);
  const currentYear = new Date(tomorrow - DAY_MS).getUTCFullYear();
  if (
    yearParam !== null &&
    (!/^\d{4}$/.test(yearParam) || year < 1970 || year > currentYear)
  ) {
    return reply({ error: 'Invalid coverage year.' }, 400);
  }
  const to =
    yearParam === null
      ? Number(query.get('to'))
      : Math.min(Date.UTC(year + 1, 0, 1), tomorrow);
  const from = yearParam === null ? to - 30 * DAY_MS : Date.UTC(year, 0, 1);
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
    const polling = day === undefined && query.get('progress') === '1';
    const { entry, result, status } = getCachedDataCoverage({
      dataset: id,
      period: { from, to },
      refresh: day === undefined && query.get('refresh') === '1',
      annual: yearParam !== null,
      polling,
    });
    if (polling) {
      if (entry.failed)
        return reply(
          { error: 'Could not read data from TimescaleDB.' },
          503,
          status,
        );
      if (!entry.snapshot)
        return reply(
          {
            ...entry.progress,
            coverage: entry.previous?.coverage,
          },
          202,
          status,
        );
      return reply(entry.snapshot.coverage, 200, status);
    }
    const snapshot = await result;
    return reply(
      day === undefined ? snapshot.coverage : snapshot.readDay(day),
      200,
      status,
    );
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('Could not read market data coverage: %o', error);
    return reply({ error: 'Could not read data from TimescaleDB.' }, 500);
  }
}
