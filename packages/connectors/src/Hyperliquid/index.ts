import { fetchWithRetry } from '@tradejs/core/http';
import {
  resolveConnectorUniverse,
  type ConnectorCreator,
  type FundingRatePoint,
  type Interval,
  type Kline,
  type Ticker,
} from '@tradejs/types';
import { decorateConnectorKline } from '../shared/runtime';

const provider = 'hyperliquid';
const hour = 3_600_000;
const maximumCandles = 5_000;
const capabilities = {
  supportedUniverses: ['crypto'],
  defaultUniverse: 'crypto',
} as const;
const intervals = {
  '1': ['1m', 1],
  '3': ['3m', 3],
  '5': ['5m', 5],
  '15': ['15m', 15],
  '30': ['30m', 30],
  '60': ['1h', 60],
  '120': ['2h', 120],
  '240': ['4h', 240],
  '720': ['12h', 720],
  D: ['1d', 1_440],
  W: ['1w', 10_080],
} as const;
const intervalFor = (interval: Interval) =>
  intervals[interval as keyof typeof intervals];

interface Asset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}
interface Meta {
  universe: Asset[];
}
interface AssetContext {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  dayBaseVlm: string;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
}
interface VenueCandle {
  s: string;
  i: string;
  t: number;
  T: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}
interface VenueFunding {
  coin: string;
  time: number;
  fundingRate: string;
}

const quoteAsset = (coin: string) =>
  coin === 'HYPE' || coin === 'PURR' ? 'USDC' : 'USDT';
const symbolFor = (coin: string) => `${coin.toUpperCase()}${quoteAsset(coin)}`;

interface VenueBook {
  coin: string;
  time: number;
  levels: [{ px: string; sz: string }[], { px: string; sz: string }[]];
}

async function info<T>(request: object): Promise<T> {
  const response = await fetchWithRetry('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid /info returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const matches = (asset: Asset, symbols?: readonly string[]) =>
  !symbols?.length ||
  symbols.some(
    (symbol) => symbol.trim().toUpperCase() === symbolFor(asset.name),
  );

const tradingUnavailable = async (): Promise<never> => {
  throw new Error('Hyperliquid connector supports public market data only');
};

export const HyperliquidConnectorCreator: ConnectorCreator = async (
  config,
  runtime,
) => {
  const universe = resolveConnectorUniverse(capabilities, config.universe);
  let state = {};

  let cachedMeta: { expiresAt: number; request: Promise<Meta> } | undefined;
  const getMeta = () => {
    const now = Date.now();
    if (cachedMeta && cachedMeta.expiresAt > now) return cachedMeta.request;
    const request = info<Meta>({ type: 'meta' }).catch((error: unknown) => {
      if (cachedMeta?.request === request) cachedMeta = undefined;
      throw error;
    });
    cachedMeta = { expiresAt: now + 60_000, request };
    return request;
  };
  const coinFor = async (symbol: string) => {
    const normalized = symbol.trim().toUpperCase();
    const meta = await getMeta();
    const asset = meta.universe.find(
      ({ name }) => symbolFor(name) === normalized,
    );
    if (!asset)
      throw new Error(`Unknown Hyperliquid perpetual symbol: ${symbol}`);
    return asset.name;
  };

  const getBook = async (symbol: string, limit = 20) => {
    const coin = await coinFor(symbol);
    const book = await info<VenueBook | null>({ type: 'l2Book', coin });
    if (book === null) return null;
    if (
      book.coin !== coin ||
      !Number.isSafeInteger(book.time) ||
      book.levels.length !== 2
    ) {
      throw new Error(`Invalid Hyperliquid order book for ${symbol}`);
    }
    const mapSide = (side: VenueBook['levels'][number]) =>
      side.slice(0, limit).map(({ px, sz }): [number, number] => {
        const price = Number(px),
          quantity = Number(sz);
        if (
          !Number.isFinite(price) ||
          price <= 0 ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          throw new Error(`Invalid Hyperliquid order book level for ${symbol}`);
        }
        return [price, quantity];
      });
    return {
      symbol: symbolFor(coin),
      lastUpdateId: null,
      bids: mapSide(book.levels[0]),
      asks: mapSide(book.levels[1]),
      timestamp: book.time,
    };
  };

  const requestKline: Kline = async ({ symbol, interval, start, end }) => {
    const coin = await coinFor(symbol);
    const venueInterval = intervalFor(interval);
    if (!venueInterval) {
      throw new Error(`Unsupported Hyperliquid candle interval: ${interval}`);
    }
    const [name, minutes] = venueInterval;
    const now = Date.now();
    const endTime = Math.min(end, now);
    const startTime =
      start ?? Math.max(0, endTime - minutes * 60_000 * (maximumCandles - 1));
    if (endTime < startTime) return [];
    // The venue retains a rolling window. Re-requesting older chunks cannot retrieve them.
    const candles = await info<VenueCandle[]>({
      type: 'candleSnapshot',
      req: { coin, interval: name, startTime, endTime },
    });
    if (!Array.isArray(candles))
      throw new Error('Invalid Hyperliquid candle response');
    const accepted = new Map<number, Awaited<ReturnType<Kline>>[number]>();
    for (const candle of candles) {
      if (candle.s !== coin || candle.i !== name) {
        throw new Error(`Unexpected Hyperliquid candle for ${symbol}`);
      }
      if (candle.t < startTime || candle.t > endTime || candle.T >= now)
        continue;
      const [open, high, low, close, volume] = [
        candle.o,
        candle.h,
        candle.l,
        candle.c,
        candle.v,
      ].map(Number);
      if (
        !Number.isSafeInteger(candle.t) ||
        !Number.isSafeInteger(candle.T) ||
        candle.T < candle.t ||
        ![open, high, low, close, volume].every(Number.isFinite) ||
        low <= 0 ||
        high < Math.max(open, close) ||
        low > Math.min(open, close) ||
        volume < 0
      ) {
        throw new Error(`Invalid Hyperliquid OHLCV for ${symbol}`);
      }
      accepted.set(candle.t, {
        timestamp: candle.t,
        dt: new Date(candle.t).toISOString(),
        open,
        high,
        low,
        close,
        volume,
        turnover: volume * close,
        trades: candle.n,
      });
    }
    return [...accepted.values()].sort((a, b) => a.timestamp - b.timestamp);
  };

  return {
    capabilities,
    universe,
    accountId: config.accountId,
    deploymentId: config.deploymentId,
    async listInstruments(query) {
      resolveConnectorUniverse(capabilities, query?.universe ?? universe);
      if (query?.assetClasses?.length && !query.assetClasses.includes('crypto'))
        return [];
      const meta = await getMeta();
      return meta.universe
        .filter((asset) => matches(asset, query?.symbols))
        .map((asset) => ({
          provider,
          symbol: symbolFor(asset.name),
          displayName: asset.name,
          kind: 'perpetual',
          assetClass: 'crypto',
          universe: 'crypto',
          status: asset.isDelisted ? 'inactive' : 'trading',
          baseAsset: asset.name,
          quoteAsset: quoteAsset(asset.name),
          settleAsset: 'USDC',
          venueMetadata: {
            coin: asset.name,
            szDecimals: asset.szDecimals,
            maxLeverage: asset.maxLeverage,
          },
        }));
    },
    kline: decorateConnectorKline(runtime, {
      provider,
      request: requestKline,
      limit: maximumCandles,
      intervalToMinutes: (interval) => intervalFor(interval)?.[1] ?? null,
    }),
    async getTickers(query) {
      resolveConnectorUniverse(capabilities, query?.universe ?? universe);
      if (query?.assetClasses?.length && !query.assetClasses.includes('crypto'))
        return [];
      const [meta, contexts] = await info<[Meta, AssetContext[]]>({
        type: 'metaAndAssetCtxs',
      });
      if (meta.universe.length !== contexts.length)
        throw new Error('Hyperliquid metadata and ticker counts differ');
      return meta.universe.flatMap((asset, i): Ticker[] => {
        if (asset.isDelisted || !matches(asset, query?.symbols)) return [];
        const ctx = contexts[i];
        const prevPrice24h = Number(ctx.prevDayPx);
        const markPrice = Number(ctx.markPx);
        const lastPrice = Number(ctx.midPx ?? ctx.markPx);
        const openInterest = Number(ctx.openInterest);
        return [
          {
            symbol: symbolFor(asset.name),
            lastPrice,
            indexPrice: Number(ctx.oraclePx),
            markPrice,
            prevPrice24h,
            price24hPcnt:
              prevPrice24h > 0 ? (lastPrice - prevPrice24h) / prevPrice24h : 0,
            highPrice24h: 0,
            lowPrice24h: 0,
            prevPrice1h: 0,
            openInterest,
            openInterestValue: openInterest * markPrice,
            turnover24h: Number(ctx.dayNtlVlm),
            volume24h: Number(ctx.dayBaseVlm ?? 0),
            fundingRate: Number(ctx.funding),
            nextFundingTime: (Math.floor(Date.now() / hour) + 1) * hour,
            predictedDeliveryPrice: '',
            basisRate: '',
            deliveryFeeRate: '',
            deliveryTime: 0,
            ask1Size: 0,
            bid1Price: 0,
            ask1Price: 0,
            bid1Size: 0,
            basis: '',
            preOpenPrice: '',
            preQty: '',
          },
        ];
      });
    },
    async getFundingRateHistory({ symbol, startTime, endTime, limit }) {
      const coin = await coinFor(symbol);
      const rates = new Map<number, FundingRatePoint>();
      let cursor = startTime ?? Math.max(0, endTime - (limit ?? 500) * hour);
      while (cursor <= endTime && (limit === undefined || rates.size < limit)) {
        const page = await info<VenueFunding[]>({
          type: 'fundingHistory',
          coin,
          startTime: cursor,
          endTime,
        });
        if (!Array.isArray(page))
          throw new Error('Invalid Hyperliquid funding response');
        if (!page.length) break;
        let newest = cursor - 1;
        for (const row of page) {
          const rate = Number(row.fundingRate);
          if (
            row.coin !== coin ||
            !Number.isSafeInteger(row.time) ||
            !Number.isFinite(rate)
          ) {
            throw new Error(`Invalid Hyperliquid funding point for ${symbol}`);
          }
          if (row.time < cursor || row.time > endTime) continue;
          rates.set(row.time, {
            symbol: symbolFor(coin),
            timestamp: row.time,
            rate,
          });
          newest = Math.max(newest, row.time);
        }
        if (newest < cursor || page.length < 500) break;
        cursor = newest + 1;
      }
      return [...rates.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, limit ?? rates.size);
    },
    getOrderBookDepth: ({ symbol, limit }) => getBook(symbol, limit),
    async getTopOfBookTicker(symbol) {
      const book = await getBook(symbol, 1);
      if (!book?.bids.length || !book.asks.length) return null;
      const [[bidPrice, bidQty]] = book.bids;
      const [[askPrice, askQty]] = book.asks;
      return {
        symbol: book.symbol,
        bidPrice,
        bidQty,
        askPrice,
        askQty,
        timestamp: book.timestamp,
      };
    },
    async getTradingFeeRate(symbol) {
      return {
        symbol: symbolFor(await coinFor(symbol)),
        makerRate: 0.00015,
        takerRate: 0.00045,
        source: 'connector-default',
        capturedAt: Date.now(),
      };
    },
    getState: async () => state,
    setState: async (next) => {
      state = { ...state, ...next };
    },
    getPosition: tradingUnavailable,
    getPositions: tradingUnavailable,
    placeOrder: tradingUnavailable,
    setTakeProfits: tradingUnavailable,
    setStopLoss: tradingUnavailable,
    closePosition: tradingUnavailable,
  };
};
