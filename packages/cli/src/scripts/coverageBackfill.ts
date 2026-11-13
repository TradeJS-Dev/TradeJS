import {
  connectors,
  ConnectorNames,
  marketDataProviders,
} from '@tradejs/connectors';
import { toRows, upsertCandles } from '@tradejs/infra/timescale/candles';
import { waitForDbReady } from '@tradejs/infra/timescale/client';
import {
  readDataBackfillSlots,
  resolveDataBackfill,
} from '@tradejs/infra/timescale/dataCoverage';
import { upsertDerivatives } from '@tradejs/infra/timescale/derivatives';
import {
  upsertMarketBreadthRows,
  upsertMarketTradeFlowRows,
} from '@tradejs/infra/timescale/marketContext';
import { upsertSpreadRows } from '@tradejs/infra/timescale/spread';
import { getBinanceBreadthUniverses } from '@tradejs/node/strategies';
import type {
  DataBackfillRequest,
  DataBackfillResult,
  DerivativesRow,
  KlineChartData,
} from '@tradejs/types';
import {
  buildKlineTradeFlowRows,
  buildMarketBreadthRows,
} from '../lib/binanceMarketData';
import {
  backfillCoinMarketCapContext,
  resolveCoinMarketCapBackfillWindow,
} from '../lib/coinMarketCapContextBackfill';
import { resolveCoinalyzeBackfillMarket } from '../lib/derivativesContextBackfill';

type Target = NonNullable<ReturnType<typeof resolveDataBackfill>>;
const DAY_MS = 86_400_000;

async function fetchTarget(
  userName: string,
  request: DataBackfillRequest,
  target: Target,
  loaded: Set<number>,
): Promise<DataBackfillResult['outcome']> {
  const { dataset, end } = target;
  const { series, day } = request;
  const endMs = end - 1;
  const interval = dataset.interval;
  const missing = (time: number) =>
    time >= day && time < end && !loaded.has(time);
  if (dataset.provider === 'CoinMarketCap') {
    const params = {
      userName,
      startMs: day,
      preloadStartMs: day,
      endMs: end,
      repairDataset: dataset.id,
    };
    if (resolveCoinMarketCapBackfillWindow(params).fromMs > day)
      return 'outside_configured_history';
    await backfillCoinMarketCapContext(params);
    return;
  }
  if (dataset.provider === 'Coinalyze') {
    if (interval !== '15m' && interval !== '1h') return;
    const { apiKey, marketSymbol } = await resolveCoinalyzeBackfillMarket(
      userName,
      series,
    );
    if (!marketSymbol) return 'no_matching_market';
    const { derivativesRows = [] } =
      await marketDataProviders.coinalyze.fetchWindow({
        symbol: series,
        marketSymbol,
        apiKey,
        interval,
        fromMs: day,
        toMs: endMs,
      });
    await upsertDerivatives(
      derivativesRows
        .filter(({ ts }) => missing(ts.getTime()))
        .flatMap<DerivativesRow>((row) => {
          const { symbol, ts, interval, source } = row;
          if (dataset.id.startsWith('coinalyze-open-interest-')) {
            return row.openInterest == null
              ? []
              : [
                  {
                    symbol,
                    ts,
                    interval,
                    source,
                    openInterest: row.openInterest,
                  },
                ];
          }
          if (dataset.id.startsWith('coinalyze-funding-')) {
            return row.fundingRate == null
              ? []
              : [
                  {
                    symbol,
                    ts,
                    interval,
                    source,
                    fundingRate: row.fundingRate,
                  },
                ];
          }
          const { liqLong, liqShort, liqTotal } = row;
          return liqLong == null && liqShort == null && liqTotal == null
            ? []
            : [{ symbol, ts, interval, source, liqLong, liqShort, liqTotal }];
        }),
    );
    return;
  }
  if (dataset.id === 'binance-coinbase-spread-15m') {
    const { spreadRows = [] } =
      await marketDataProviders.binance_coinbase_spread.fetchWindow({
        symbol: series,
        interval: '15m',
        fromMs: day,
        toMs: endMs,
      });
    await upsertSpreadRows(
      spreadRows.filter(({ ts }) => missing(ts.getTime())),
    );
    return;
  }

  const provider = dataset.provider === 'Bybit' ? 'bybit' : 'binance';
  const connector = await connectors[
    provider === 'bybit' ? ConnectorNames.ByBit : ConnectorNames.Binance
  ]({ userName });
  const connectorInterval =
    interval === '5m' ? '5' : interval === '1h' ? '60' : '15';
  const fetchCandles = async (symbol: string, start: number) => {
    const candles = await connector.kline({
      symbol,
      interval: connectorInterval,
      start,
      end: endMs,
      silent: true,
    });
    return candles.filter(
      ({ timestamp }) => timestamp >= start && timestamp < end,
    );
  };
  if (dataset.id.includes('-candles-')) {
    const candles = (await fetchCandles(series, day)).filter(({ timestamp }) =>
      missing(timestamp),
    );
    await upsertCandles(
      toRows(provider, series, Number(connectorInterval), candles),
    );
    return;
  }
  if (interval === '1d') return;
  if (dataset.id.startsWith('binance-trade-flow-')) {
    await upsertMarketTradeFlowRows(
      buildKlineTradeFlowRows({
        symbol: series,
        interval,
        candles: (await fetchCandles(series, day)).filter(({ timestamp }) =>
          missing(timestamp),
        ),
      }),
    );
    return;
  }
  const universe = getBinanceBreadthUniverses().find(
    (item) => item.universe === series,
  );
  if (!universe) return 'historical_basket_unavailable';
  const candlesBySymbol: Record<string, KlineChartData> = {};
  const warmup = day - 2 * DAY_MS;
  for (let offset = 0; offset < universe.symbols.length; offset += 4) {
    const entries = await Promise.all(
      universe.symbols
        .slice(offset, offset + 4)
        .map(
          async (symbol) =>
            [symbol, await fetchCandles(symbol, warmup)] as const,
        ),
    );
    Object.assign(candlesBySymbol, Object.fromEntries(entries));
  }
  const rows = buildMarketBreadthRows({
    universe: series,
    interval,
    candlesBySymbol,
    btcCandles:
      candlesBySymbol.BTCUSDT ?? (await fetchCandles('BTCUSDT', warmup)),
  });
  await upsertMarketBreadthRows(rows.filter(({ ts }) => missing(ts.getTime())));
}

export async function main() {
  const [userName, dataset, series, day] = process.argv.slice(2);
  const request = { dataset, series, day: Number(day) };
  const target = resolveDataBackfill(request);
  if (!target || !userName)
    throw new Error(
      'Expected user, dataset, series and UTC day in milliseconds.',
    );
  await waitForDbReady();
  const before = await readDataBackfillSlots(request, target.end);
  const outcome =
    before.loaded.size < before.expected
      ? await fetchTarget(userName, request, target, before.loaded)
      : undefined;
  const after = await readDataBackfillSlots(request, target.end);
  const result: DataBackfillResult = {
    loaded: after.loaded.size,
    added: Math.max(0, after.loaded.size - before.loaded.size),
    missing: Math.max(0, after.expected - after.loaded.size),
  };
  if (result.missing) {
    result.outcome =
      outcome ??
      (result.added ? 'some_missing_slots_filled' : 'no_missing_slots_filled');
  }
  console.log(`TRADEJS_DATA_BACKFILL ${JSON.stringify(result)}`);
}
