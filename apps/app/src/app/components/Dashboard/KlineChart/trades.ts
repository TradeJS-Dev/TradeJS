import type { OrderLog, OrderLogData } from '@tradejs/types';

export type BacktestRun = 'A' | 'B';

export interface ChartTrade {
  id: number;
  entry: OrderLog;
  events: OrderLogData;
  remaining: number;
  profit: number;
  fee: number | null;
  lastExit?: OrderLog;
}

export const getChartTrades = (orders: OrderLogData): ChartTrade[] => {
  const active = new Map<string, ChartTrade>();
  const trades: ChartTrade[] = [];

  for (const order of [...orders].sort(
    (a, b) => a.timestamp - b.timestamp || a.index - b.index,
  )) {
    // A backtest has one open position per symbol and direction. An increase
    // can have a different signal ID from the original entry.
    const key = `${order.symbol}:${order.direction}`;
    const isEntry = order.type.startsWith('OPEN_');
    let trade = active.get(key);
    if (!trade) {
      if (!isEntry) continue;
      trade = {
        id: order.index,
        entry: order,
        events: [],
        remaining: 0,
        profit: 0,
        fee: 0,
      };
      active.set(key, trade);
      trades.push(trade);
    }

    trade.events.push(order);
    trade.profit += order.profit;
    trade.fee =
      trade.fee === null || order.fee == null ? null : trade.fee + order.fee;
    trade.remaining += isEntry ? order.qty : -order.qty;
    if (!isEntry) {
      trade.lastExit = order;
      if (trade.remaining <= 1e-8) active.delete(key);
    }
  }

  return trades;
};

const compareExit = (trade: ChartTrade) =>
  JSON.stringify(
    trade.events
      .filter((event) => !event.type.startsWith('OPEN_'))
      .map(({ timestamp, price, qty, type }) => [timestamp, price, qty, type]),
  );

export type TradeDifference = 'Only A' | 'Only B' | 'Exit changed' | 'Matched';

export const compareTradeEntries = (
  primary: ChartTrade[],
  secondary: ChartTrade[],
) => {
  const groups = new Map<string, ChartTrade[]>();
  const keyFor = (trade: ChartTrade) =>
    `${trade.entry.timestamp}:${trade.entry.direction}`;
  for (const trade of secondary) {
    const key = keyFor(trade);
    const group = groups.get(key) ?? [];
    group.push(trade);
    groups.set(key, group);
  }

  const A = new Map<number, TradeDifference>();
  const B = new Map<number, TradeDifference>(
    secondary.map(({ id }) => [id, 'Only B']),
  );
  for (const trade of primary) {
    const match = groups.get(keyFor(trade))?.shift();
    const difference = !match
      ? 'Only A'
      : compareExit(trade) === compareExit(match)
        ? 'Matched'
        : 'Exit changed';
    A.set(trade.id, difference);
    if (match) B.set(match.id, difference);
  }
  return { A, B };
};

// Find the first candle at or after a trade event, matching the backtest overlay.
export const findCandleIndex = (
  candles: readonly { timestamp: number }[],
  timestamp: number,
) => {
  let from = 0;
  let to = candles.length;
  while (from < to) {
    const middle = Math.floor((from + to) / 2);
    if (candles[middle].timestamp < timestamp) from = middle + 1;
    else to = middle;
  }
  return from;
};
