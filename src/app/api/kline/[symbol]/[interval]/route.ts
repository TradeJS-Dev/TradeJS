import { NextRequest, NextResponse } from 'next/server';
import { connectors } from '@src/connectors';
import { KlineRequest, Interval } from '@types';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

interface Params {
  symbol: string;
  interval: string;
}

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { symbol, interval } = await params;
    const body = await request.json();
    const options = body as
      | Omit<KlineRequest, 'symbol' | 'interval'>
      | undefined;

    if (!options || !symbol || !interval || !options.end) {
      return NextResponse.json(
        { error: 'Missing required kline parameters' },
        { status: 400 },
      );
    }

    const byBitConnector = await connectors.ByBit({
      userName: 'root',
    });

    const data = await byBitConnector.kline({
      symbol,
      interval: interval as Interval,
      ...options,
    });

    return NextResponse.json({ data });
  } catch (error) {
    logger.log('error', `Kline fetch error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
