import { NextResponse } from 'next/server';
import { ConnectorCreator } from '@tradejs/types';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { getTopTickers } from '@tradejs/core/tickers';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

interface Params {
  provider: string;
}

export const GET = async (
  _request: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { provider } = await params;
    const connectorCreator =
      (await getConnectorCreatorByProvider(provider, projectRoot)) ||
      (await getConnectorCreatorByProvider('bybit', projectRoot));
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }

    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
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
