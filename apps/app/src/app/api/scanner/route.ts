import { NextResponse } from 'next/server';
import { getTopTickers } from '@tradejs/core/tickers';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { logger } from '@tradejs/infra/logger';
import { ConnectorCreator } from '@tradejs/types';
import { getCurrentUserName } from '@app/lib/currentUser';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const GET = async () => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const connectorCreator = await getConnectorCreatorByProvider(
      'bybit',
      projectRoot,
    );
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }

    const byBitConnector = await (connectorCreator as ConnectorCreator)({
      userName,
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
