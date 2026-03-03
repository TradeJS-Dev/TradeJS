import { NextRequest, NextResponse } from 'next/server';
import {
  connectors,
  providerToConnectorName,
  ConnectorProviders,
} from '@tradejs/connectors';
import { KlineRequest, Interval, ConnectorCreator } from '@types';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

interface Params {
  provider: string;
  symbol: string;
  interval: string;
}

const asProvider = (value: string): ConnectorProviders => {
  if (value === 'binance') return ConnectorProviders.binance;
  if (value === 'coinbase') return ConnectorProviders.coinbase;
  return ConnectorProviders.bybit;
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { provider, symbol, interval } = await params;
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

    const providerKey = asProvider(provider);
    const connectorName = providerToConnectorName[providerKey];
    const connector = await (connectors[connectorName] as ConnectorCreator)({
      userName: 'root',
    });

    const data = await connector.kline({
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
