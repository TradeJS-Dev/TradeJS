import { NextRequest, NextResponse } from 'next/server';
import {
  connectors,
  providerToConnectorName,
  ConnectorProviders,
} from '@tradejs/connectors';
import {
  KlineChartData,
  KlineRequest,
  Interval,
  ConnectorCreator,
} from '@types';
import { getRegisteredIndicatorEntries } from '@tradejs/core/indicators';
import { ensureIndicatorPluginsLoaded } from '@tradejs/core/strategy';
import { createIndicators } from '@utils/indicators';
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

    const baseData = await connector.kline({
      symbol,
      interval: interval as Interval,
      ...options,
    });

    await ensureIndicatorPluginsLoaded();
    const pluginKeys = getRegisteredIndicatorEntries().map(
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
