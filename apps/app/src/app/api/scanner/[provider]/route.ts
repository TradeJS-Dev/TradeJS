import { NextResponse } from 'next/server';
import {
  ConnectorCreator,
  isMarketUniverse,
  MarketUniverse,
} from '@tradejs/types';
import { getTopTickers } from '@tradejs/core/tickers';
import { logger } from '@tradejs/infra/logger';
import { resolveConnectorCreatorByProvider } from '#app/lib/connectorCreator';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

interface Params {
  provider: string;
  universe?: string;
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

    const routeParams = await params;
    const { provider, universe: requestedUniverse } = routeParams;
    const rawUniverse = requestedUniverse ?? 'crypto';
    if (!isMarketUniverse(rawUniverse)) {
      return NextResponse.json(
        { error: `Unknown market universe: ${rawUniverse}` },
        { status: 400 },
      );
    }
    const universe: MarketUniverse = rawUniverse;
    const connectorCreator = await resolveConnectorCreatorByProvider(
      provider,
      projectRoot,
    );
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }

    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
      ...(requestedUniverse ? { universe } : {}),
    });

    const data = await connector.getTickers(
      requestedUniverse ? { universe } : undefined,
    );
    const tickers = getTopTickers(data);

    return NextResponse.json({ tickers });
  } catch (error) {
    logger.log('error', `Scanner error: %o`, error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /unsupported market universe/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
};
