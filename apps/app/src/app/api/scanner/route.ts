import { NextResponse } from 'next/server';
import { connectors } from '@tradejs/connectors';
import { getTopTickers } from '@utils/tickers';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    const byBitConnector = await connectors.ByBit({
      userName: 'root',
    });

    const data = await byBitConnector.getTickers();
    const tickers = getTopTickers(data);

    return NextResponse.json({ tickers });
  } catch (error) {
    logger.log('error', `Scanner error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
