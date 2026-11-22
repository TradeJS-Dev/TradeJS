import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type {
  FundingRatePoint,
  KlineChartData,
  KlineChartItem,
} from '@tradejs/types';

type CandleSeries = {
  at(index: number): KlineChartItem | undefined;
  length: number;
};
const blockRows = 2048;
const rowBytes = 10 * 8;
const numeric = (key: PropertyKey) =>
  typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key);

export function openPortfolioSnapshot(
  directory: string,
  symbols: readonly string[],
) {
  const files = new Set<number>();
  function candles(minutes: number) {
    const folder = path.join(directory, 'candles', String(minutes));
    const indexes = JSON.parse(
      readFileSync(path.join(folder, 'index.json'), 'utf8'),
    ) as Record<string, { first: number; n: number }>;
    const reference = indexes.BTCUSDT;
    if (!reference) throw new Error('BTCUSDT snapshot is missing');
    const interval = minutes * 60_000;
    const series = new Map<string, CandleSeries>();
    for (const symbol of symbols) {
      assert.match(symbol, /^[A-Z0-9]+USDT$/);
      const bounds = indexes[symbol];
      assert.ok(bounds, `Missing ${symbol} ${minutes}m snapshot`);
      const { first, n } = bounds;
      const offset = (first - reference.first) / interval;
      assert.ok(
        Number.isInteger(offset) && offset >= 0 && offset + n === reference.n,
        symbol,
      );
      let fd: number | undefined;
      let hotBlock = -1;
      let previousBlock = -1;
      let hot: Buffer | undefined;
      let previous: Buffer | undefined;
      let latestIndex = -1;
      let latest: KlineChartItem | undefined;
      function at(index: number) {
        if (index < offset || index >= reference.n) return;
        if (index === latestIndex) return latest;
        const row = index - offset;
        const block = Math.floor(row / blockRows);
        if (block !== hotBlock && block !== previousBlock) {
          if (fd === undefined) {
            fd = openSync(path.join(folder, `${symbol}.bin`), 'r');
            files.add(fd);
          }
          const buffer = previous ?? Buffer.allocUnsafe(blockRows * rowBytes);
          previous = hot;
          previousBlock = hotBlock;
          hot = buffer;
          hotBlock = block;
          const start = block * blockRows;
          const bytes = Math.min(blockRows, n - start) * rowBytes;
          assert.equal(readSync(fd, buffer, 0, bytes, start * rowBytes), bytes);
        }
        const buffer = (block === hotBlock ? hot : previous)!;
        const byte = (row % blockRows) * rowBytes;
        const read = (field: number) => buffer.readDoubleLE(byte + field * 8);
        const optional = (field: number) => {
          const value = read(field);
          return Number.isNaN(value) ? undefined : value;
        };
        latestIndex = index;
        latest = {
          timestamp: first + row * interval,
          open: read(0),
          high: read(1),
          low: read(2),
          close: read(3),
          volume: read(4),
          turnover: read(5),
          takerBuyBaseVolume: optional(6),
          takerBuyQuoteVolume: optional(7),
          takerSellBaseVolume: optional(8),
          takerSellQuoteVolume: optional(9),
        } as KlineChartItem;
        return latest;
      }
      series.set(symbol, { at, length: reference.n });
    }
    return { first: reference.first, series };
  }

  function funding(
    symbol: string,
    start: number,
    end: number,
  ): FundingRatePoint[] {
    assert.match(symbol, /^[A-Z0-9]+USDT$/);
    const records = JSON.parse(
      gunzipSync(
        readFileSync(path.join(directory, 'funding', `${symbol}.json.gz`)),
      ).toString(),
    ) as {
      symbol: string;
      rates: [number, number][];
    };
    assert.equal(records.symbol, symbol);
    const maxGap = 8 * 3_600_000;
    assert.ok(
      records.rates[0]?.[0] <= start + maxGap &&
        records.rates.at(-1)![0] >= end - maxGap,
      symbol,
    );
    let previous: number | undefined;
    for (const [timestamp, rate] of records.rates) {
      assert.ok(
        Number.isSafeInteger(timestamp) && Number.isFinite(Number(rate)),
        symbol,
      );
      assert.ok(
        previous === undefined ||
          (timestamp > previous && timestamp - previous <= maxGap),
        symbol,
      );
      previous = timestamp;
    }
    return records.rates
      .filter(([timestamp]) => timestamp >= start && timestamp < end)
      .map(([timestamp, rate]) => ({ symbol, timestamp, rate: Number(rate) }));
  }
  return {
    candles,
    funding,
    close: () => {
      for (const fd of files) closeSync(fd);
      files.clear();
    },
  };
}

export function visiblePortfolioHistory(
  source: CandleSeries,
  start: number,
  end: number,
): KlineChartData {
  let length = end - start;
  let last = source.at(end - 1);
  assert.ok(source.at(start) && last, 'Insufficient portfolio history');
  const get = (index: number) =>
    index < 0 || index >= length
      ? undefined
      : index === length - 1
        ? last
        : source.at(start + index);
  const bound = (index: number) =>
    index < 0 ? Math.max(0, length + index) : Math.min(length, index);
  const methods = {
    at(index: number) {
      return get(index < 0 ? length + index : index);
    },
    push(...candles: KlineChartItem[]) {
      for (const candle of candles) {
        assert.equal(candle.timestamp, source.at(start + length)?.timestamp);
        last = candle;
        length++;
      }
      return length;
    },
    slice(from = 0, to = length) {
      const first = bound(from);
      return Array.from(
        { length: Math.max(0, bound(to) - first) },
        (_, index) => get(first + index),
      );
    },
  };
  return new Proxy<KlineChartData>([], {
    get(target, key, receiver) {
      if (key === 'length') return length;
      if (numeric(key)) return get(Number(key));
      if (typeof key === 'string' && Object.hasOwn(methods, key))
        return methods[key as keyof typeof methods];
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      return numeric(key) ? Number(key) < length : Reflect.has(target, key);
    },
    set(_target, key) {
      throw new Error(`Unexpected write to candle history: ${String(key)}`);
    },
  });
}
