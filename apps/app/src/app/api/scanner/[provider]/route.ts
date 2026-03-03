import { NextResponse } from 'next/server';
import {
  connectors,
  providerToConnectorName,
  ConnectorProviders,
} from '@tradejs/connectors';
import { ConnectorCreator } from '@types';
import { getTopTickers } from '@utils/tickers';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

interface Params {
  provider: string;
}

const asProvider = (value: string): ConnectorProviders => {
  if (value === 'binance') return ConnectorProviders.binance;
  if (value === 'coinbase') return ConnectorProviders.coinbase;
  return ConnectorProviders.bybit;
};

export const GET = async (
  _request: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { provider } = await params;
    const providerKey = asProvider(provider);
    const connectorName = providerToConnectorName[providerKey];
    const connector = await (connectors[connectorName] as ConnectorCreator)({
      userName: 'root',
    });

    const data = await connector.getTickers();
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
