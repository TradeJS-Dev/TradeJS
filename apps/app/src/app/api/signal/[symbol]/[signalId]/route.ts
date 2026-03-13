import _ from 'lodash';
import { NextResponse } from 'next/server';
import { getData, logger, redisKeys } from '@tradejs/infra';
import { Signal } from '@tradejs/types';

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
    const { symbol, signalId } = await params;

    if (!symbol || !signalId) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, signalId' },
        { status: 400 },
      );
    }

    let signal: Signal = await getData(redisKeys.signal(symbol, signalId));

    if (!signal || _.isEmpty(signal)) {
      signal = await getData(redisKeys.storeSignal(symbol, signalId));
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
