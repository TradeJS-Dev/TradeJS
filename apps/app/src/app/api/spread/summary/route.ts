import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getSpreadSummary } from '@tradejs/infra/timescale';

export const dynamic = 'force-dynamic';

export const GET = async (request: NextRequest) => {
  try {
    const hoursRaw = Number(request.nextUrl.searchParams.get('hours') ?? 24);
    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? 500);
    const summary = await getSpreadSummary(hoursRaw, limitRaw);
    return NextResponse.json(summary);
  } catch (error) {
    logger.log('error', 'Spread summary error: %o', error);
    return NextResponse.json(
      { error: 'Failed to load spread summary' },
      { status: 500 },
    );
  }
};
