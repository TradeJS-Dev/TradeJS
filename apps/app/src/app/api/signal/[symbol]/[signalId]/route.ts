import { NextResponse } from 'next/server';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { Signal } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

interface Params {
  symbol: string;
  signalId: string;
}

export const GET = async (
  _req: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { symbol, signalId } = await params;

    if (!symbol || !signalId) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, signalId' },
        { status: 400 },
      );
    }

    const signal: Signal = await getData(
      redisKeys.storeSignal(symbol, signalId),
    );

    return NextResponse.json({ signal });
  } catch (error) {
    logger.log('error', `Signal load error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
