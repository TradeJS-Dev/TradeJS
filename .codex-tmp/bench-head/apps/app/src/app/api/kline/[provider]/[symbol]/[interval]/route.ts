import { NextRequest, NextResponse } from 'next/server';
import {
  createIndicators,
  getRegisteredIndicatorEntries,
} from '@tradejs/core/indicators';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { ensureIndicatorPluginsLoaded } from '@tradejs/node/registry';
import { logger } from '@tradejs/infra/logger';
import {
  KlineChartData,
  KlineRequest,
  Interval,
  ConnectorCreator,
} from '@tradejs/types';
import { getCurrentUserName } from '@app/lib/currentUser';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

interface Params {
  provider: string;
  symbol: string;
  interval: string;
}

const enrichWithPluginIndicators = (
  data: KlineChartData,
  btcData: KlineChartData,
  pluginKeys: string[],
): KlineChartData => {
  if (!pluginKeys.length || !data.length) {
    return data;
  }

  const history = createIndicators(data, btcData, {
    includeMlPayload: false,
    pluginRegistryScope: projectRoot,
  }).result() as Record<string, number[]>;

  const nextData = data.map((candle) => ({ ...candle }));

  for (const pluginKey of pluginKeys) {
    const series = history[pluginKey];
    if (!Array.isArray(series) || !series.length) {
      continue;
    }

    const startIdx = nextData.length - series.length;
    for (let i = 0; i < series.length; i += 1) {
      const candleIndex = startIdx + i;
      if (candleIndex < 0 || candleIndex >= nextData.length) {
        continue;
      }
      const value = series[i];
      if (!Number.isFinite(value)) {
        continue;
      }
      (nextData[candleIndex] as Record<string, unknown>)[pluginKey] = value;
    }
  }

  return nextData;
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<Params> },
) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const connectorCreator =
      (await getConnectorCreatorByProvider(provider, projectRoot)) ||
      (await getConnectorCreatorByProvider('bybit', projectRoot));
    if (!connectorCreator) {
      throw new Error('No connector available for provider');
    }
    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
    });

    const baseData = await connector.kline({
      symbol,
      interval: interval as Interval,
      ...options,
    });

    await ensureIndicatorPluginsLoaded(projectRoot);
    const pluginKeys = getRegisteredIndicatorEntries(projectRoot).map(
      (entry) => entry.historyKey || entry.indicator.id,
    );
    if (!pluginKeys.length) {
      return NextResponse.json({ data: baseData });
    }

    const btcData =
      symbol === 'BTCUSDT'
        ? baseData
        : await connector.kline({
            symbol: 'BTCUSDT',
            interval: interval as Interval,
            ...options,
          });

    const data = enrichWithPluginIndicators(baseData, btcData, pluginKeys);

    return NextResponse.json({ data });
  } catch (error) {
    logger.log('error', `Kline fetch error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
