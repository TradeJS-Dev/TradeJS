import { NextResponse } from 'next/server';
import { getData, getHashJsonField, redisKeys } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { getRuntimeStorageDayKey } from '@tradejs/core/time';
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

    const signal: Signal | null = await getData(
      redisKeys.storeSignal(symbol, signalId),
      null,
    );

    if (signal) {
      const reference = await getHashJsonField<{ symbol: string }>(
        redisKeys.runtimeSignalBucket(
          userName,
          getRuntimeStorageDayKey(signal.timestamp),
          signal.strategy,
        ),
        signalId,
        null,
      );
      if (
        !reference ||
        reference.symbol !== symbol ||
        signal.symbol !== symbol ||
        signal.signalId !== signalId
      ) {
        return NextResponse.json({ signal: null });
      }
    }
    return NextResponse.json({ signal });
  } catch (error) {
    logger.log('error', `Signal load error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
