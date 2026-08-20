'use client';

import { ReferenceDot } from 'recharts';
import type {
  OrderLogData,
  SimpleOrderLogData,
  StrategyChartOrder,
} from '@tradejs/types';

export interface TradeOutcomePoint {
  timestamp: number;
  equity: number;
  pnl: number;
}

interface TradeOutcomeCandidate {
  timestamp?: number | null;
  equity?: number | null;
  pnl?: number | null;
}

export const normalizeTradeOutcomePoints = (
  candidates: readonly TradeOutcomeCandidate[],
): TradeOutcomePoint[] =>
  candidates.flatMap(({ timestamp, equity, pnl }) =>
    typeof timestamp === 'number' &&
    Number.isFinite(timestamp) &&
    typeof equity === 'number' &&
    Number.isFinite(equity) &&
    typeof pnl === 'number' &&
    Number.isFinite(pnl) &&
    pnl !== 0
      ? [{ timestamp, equity, pnl }]
      : [],
  );

export const buildEquityTradeOutcomePoints = (
  orderLog: SimpleOrderLogData,
): TradeOutcomePoint[] =>
  normalizeTradeOutcomePoints(
    orderLog.slice(1).map(([timestamp, equity], index) => ({
      timestamp,
      equity,
      pnl: equity - orderLog[index][1],
    })),
  );

export const buildSnapshotTradeOutcomePoints = (
  orders: readonly StrategyChartOrder[],
): TradeOutcomePoint[] =>
  normalizeTradeOutcomePoints(
    orders.map((order) => ({
      timestamp: order.exitTimestamp,
      equity: order.equityAfter,
      pnl: order.pnl,
    })),
  );

export const buildBacktestTradeOutcomePoints = (
  orders: OrderLogData,
): TradeOutcomePoint[] =>
  normalizeTradeOutcomePoints(
    orders
      .filter((order) => !order.type.startsWith('OPEN'))
      .map((order) => ({
        timestamp: order.timestamp,
        equity: order.amount,
        pnl: order.profit,
      })),
  );

export const TradeOutcomeMarkers = ({
  points,
  positiveColor,
  negativeColor,
}: {
  points: readonly TradeOutcomePoint[];
  positiveColor: string;
  negativeColor: string;
}) => (
  <>
    {points.map((point, index) => (
      <ReferenceDot
        key={`${point.timestamp}:${point.equity}:${index}`}
        x={point.timestamp}
        y={point.equity}
        r={2.5}
        fill={point.pnl > 0 ? positiveColor : negativeColor}
        stroke="none"
      />
    ))}
  </>
);
