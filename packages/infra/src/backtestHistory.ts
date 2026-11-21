import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { BacktestHistoryStorage, Candle } from '@tradejs/types';

const pageSize = 256;
const recentPageLimit = 32_768;

interface Page {
  offset: number;
  size: number;
}

const indexOf = (key: PropertyKey): number | undefined => {
  if (typeof key !== 'string' || key.length === 0) return;
  const index = Number(key);
  if (Number.isSafeInteger(index) && index >= 0 && String(index) === key) {
    return index;
  }
};

const sliceBound = (index: number, length: number) => {
  const integer = Math.trunc(index) || 0;
  return integer < 0
    ? Math.max(length + integer, 0)
    : Math.min(integer, length);
};

/** Temporary backing storage for append-only replay histories. Close after all consumers finish. */
export const createDiskBacktestHistory = (
  directory = tmpdir(),
): BacktestHistoryStorage & { close(): void } => {
  let backing: { directory: string; fd: number } | undefined;
  let closed = false;
  let nextOffset = 0;
  const recentPages = new Map<string, Page>();

  const checkOpen = () => {
    if (closed) throw new Error('Backtest history storage is closed');
  };

  const store = <T>(values: T[]): Page => {
    checkOpen();
    const data = serialize(values);
    const checksum = createHash('sha256').update(data).digest('base64');
    const previous = recentPages.get(checksum);
    if (previous) return previous;

    if (!backing) {
      const folder = mkdtempSync(join(directory, 'tradejs-backtest-history-'));
      try {
        backing = {
          directory: folder,
          fd: openSync(join(folder, 'pages'), 'wx+', 0o600),
        };
      } catch (error) {
        rmSync(folder, { recursive: true, force: true });
        throw error;
      }
    }
    const page = { offset: nextOffset, size: data.length };
    if (
      writeSync(backing.fd, data, 0, data.length, page.offset) !== data.length
    ) {
      throw new Error('Incomplete write to backtest history');
    }
    nextOffset += page.size;
    recentPages.set(checksum, page);
    if (recentPages.size > recentPageLimit) {
      const oldest = recentPages.keys().next();
      if (!oldest.done) recentPages.delete(oldest.value);
    }
    return page;
  };

  const load = <T>(page: Page): T[] => {
    checkOpen();
    if (!backing) throw new Error('Missing backtest history file');
    const data = Buffer.allocUnsafe(page.size);
    if (
      readSync(backing.fd, data, 0, data.length, page.offset) !== data.length
    ) {
      throw new Error('Incomplete read from backtest history');
    }
    // The private file only contains pages serialized by this storage instance.
    return deserialize(data) as T[];
  };

  const createSeries = <T>(seed: readonly T[] = []): T[] => {
    checkOpen();
    const pages: Page[] = [];
    let tail: T[] = [];
    let cachedPage: { index: number; values: T[] } | undefined;
    let length = 0;
    const push = (...values: T[]) => {
      checkOpen();
      for (const value of values) {
        if (tail.length === 2 * pageSize) {
          pages.push(store(tail.slice(0, pageSize)));
          tail = tail.slice(pageSize);
        }
        tail.push(value);
        length++;
      }
      return length;
    };
    const get = (index: number): T | undefined => {
      checkOpen();
      if (index < 0 || index >= length) return;
      const tailStart = pages.length * pageSize;
      if (index >= tailStart) return tail[index - tailStart];
      const pageIndex = Math.floor(index / pageSize);
      if (cachedPage?.index !== pageIndex) {
        cachedPage = { index: pageIndex, values: load(pages[pageIndex]) };
      }
      return cachedPage.values[index % pageSize];
    };
    const slice = (start = 0, end = length): T[] => {
      checkOpen();
      const lo = sliceBound(start, length);
      const hi = sliceBound(end, length);
      if (lo >= hi) return [];
      const tailStart = pages.length * pageSize;
      if (lo >= tailStart) return tail.slice(lo - tailStart, hi - tailStart);
      const result: T[] = [];
      for (let i = lo; i < hi; i++) result.push(get(i)!);
      return result;
    };
    for (const value of seed) push(value);

    return new Proxy<T[]>([], {
      get(target, key, receiver) {
        if (key === 'length') return length;
        if (key === 'push') return push;
        if (key === 'slice') return slice;
        const index = indexOf(key);
        return index === undefined
          ? Reflect.get(target, key, receiver)
          : get(index);
      },
      has(target, key) {
        const index = indexOf(key);
        return index === undefined ? Reflect.has(target, key) : index < length;
      },
      ownKeys() {
        return [
          ...Array.from({ length }, (_, index) => String(index)),
          'length',
        ];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'length') {
          return {
            ...Reflect.getOwnPropertyDescriptor(target, key)!,
            value: length,
          };
        }
        const index = indexOf(key);
        if (index !== undefined && index < length) {
          return { value: get(index), enumerable: true, configurable: true };
        }
      },
      set(_target, key, value) {
        checkOpen();
        if (key !== 'length' || value !== 0) {
          throw new TypeError(
            'Backtest histories support append and clearing only',
          );
        }
        pages.length = 0;
        tail = [];
        cachedPage = undefined;
        length = 0;
        return true;
      },
    });
  };

  return {
    numbers: () => createSeries<number>(),
    candles: <T extends Candle>(seed?: readonly T[]) => createSeries(seed),
    close() {
      if (closed) return;
      closed = true;
      recentPages.clear();
      if (backing) {
        try {
          closeSync(backing.fd);
        } finally {
          rmSync(backing.directory, { recursive: true, force: true });
        }
      }
    },
  };
};
