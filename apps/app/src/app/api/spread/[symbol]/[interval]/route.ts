import { NextRequest, NextResponse } from 'next/server';
import { getSpreadRangeForSymbols } from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';
import type { DerivativesInterval } from '@tradejs/types';

export const dynamic = 'force-dynamic';

interface Params {
  symbol: string;
  interval: string;
}

const asInterval = (value: string): DerivativesInterval | null => {
  if (value === '15m' || value === '1h') return value;
  return null;
};

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { symbol, interval } = await params;
    const tf = asInterval(interval);
    if (!tf) {
      return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
    }

    const fromRaw = Number(request.nextUrl.searchParams.get('from') ?? 0);
    const toRaw = Number(request.nextUrl.searchParams.get('to') ?? Date.now());
    const startMs =
      Number.isFinite(fromRaw) && fromRaw > 0
        ? fromRaw
        : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const endMs = Number.isFinite(toRaw) ? toRaw : Date.now();

    const rows = await getSpreadRangeForSymbols(
      [String(symbol).toUpperCase()],
      tf,
      startMs,
      endMs,
    );
    return NextResponse.json({
      rows,
      symbol: String(symbol).toUpperCase(),
      interval: tf,
    });
  } catch (error) {
    logger.log('error', 'Spread range error: %o', error);
    return NextResponse.json(
      { error: 'Failed to load spread data' },
      { status: 500 },
    );
  }
};
