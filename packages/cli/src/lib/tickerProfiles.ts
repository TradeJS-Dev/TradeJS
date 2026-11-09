import {
  buildTickerProfileSnapshot,
  tickerProfileMonth,
  tickerProfileNextMonth,
} from '@tradejs/core/tickerProfiles';
import { getKlineCandlesRange } from '@tradejs/infra/timescale/candles';
import { writeTickerProfiles } from '@tradejs/infra/tickerProfiles';
import type { Candle } from '@tradejs/types';

/** Explicit frozen universe, cached candles only. No exchange/network history refresh. */
export const prepareTickerProfiles = async ({
  projectRoot,
  provider,
  universeId,
  symbols,
  start,
  end,
}: {
  projectRoot: string;
  provider: string;
  universeId: string;
  symbols: string[];
  start: number;
  end: number;
}) => {
  if (!Number.isSafeInteger(end) || end <= start)
    throw new Error('Invalid profile time window');
  if (
    !symbols.length ||
    new Set(symbols).size !== symbols.length ||
    symbols.some((s) => !/^[A-Z0-9]+USDT$/.test(s))
  )
    throw new Error('Supply a unique explicit USDT universe');
  if (!symbols.includes('BTCUSDT') || !symbols.includes('ETHUSDT'))
    throw new Error('The universe must include BTCUSDT and ETHUSDT references');
  const receipts: {
    asOf: number;
    snapshotId: string;
    symbols: number;
    unknown: number;
  }[] = [];
  for (
    let asOf = tickerProfileMonth(start);
    asOf < end;
    asOf = tickerProfileNextMonth(asOf)
  ) {
    const candlesBySymbol: Record<string, Candle[]> = {};
    for (const symbol of [...symbols].sort())
      candlesBySymbol[symbol] = await getKlineCandlesRange(
        provider,
        symbol,
        60,
        asOf - 721 * 3_600_000,
        asOf - 3_600_000,
      );
    const snapshot = buildTickerProfileSnapshot({
      asOf,
      provider,
      universeId,
      membership: 'frozen-list',
      candlesBySymbol,
    });
    const snapshotId = await writeTickerProfiles(projectRoot, snapshot);
    receipts.push({
      asOf,
      snapshotId,
      symbols: snapshot.profiles.length,
      unknown: snapshot.profiles.filter(
        (p) => p.moneyGroup === 'unknown' || p.volatilityGroup === 'unknown',
      ).length,
    });
  }
  return receipts;
};
