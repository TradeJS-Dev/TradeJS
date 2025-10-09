import { NextResponse } from 'next/server';
import { getData, redisKeys } from '@utils/redis';
import { logger } from '@utils/logger';
import { Signal } from '@types';

export const dynamic = 'force-dynamic';

interface Params {
  symbol: string;
  signalId: string;
}

export const GET = async (_req: Request, { params }: { params: Params }) => {
  try {
    const { symbol, signalId } = params;

    if (!symbol || !signalId) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, signalId' },
        { status: 400 },
      );
    }

    const signal: Signal = await getData(redisKeys.signal(symbol, signalId));

    return NextResponse.json({ signal });
  } catch (error) {
    logger.log('error', `Signal load error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
