import { NextResponse } from 'next/server';
import { ConnectorCreator } from '@tradejs/types';
import { getConnectorCreatorByProvider } from '@tradejs/core/connectors';
import { getTopTickers } from '@tradejs/core/tickers';
import { logger } from '@tradejs/infra';

export const dynamic = 'force-dynamic';

interface Params {
  provider: string;
}

export const GET = async (
  _request: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { provider } = await params;
    const connectorCreator =
      (await getConnectorCreatorByProvider(provider)) ||
      (await getConnectorCreatorByProvider('bybit'));
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }

    const connector = await (connectorCreator as ConnectorCreator)({
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
