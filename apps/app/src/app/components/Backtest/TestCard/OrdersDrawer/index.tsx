'use client';

import { useMemo, useState } from 'react';
import { Button } from '@chakra-ui/react';
import type { OrderLogData } from '@tradejs/types';
import {
  formatCompactNumber,
  formatFee,
  formatInteger,
  formatPercent,
  formatSignedNumber,
  getPnlColor,
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
  type OrdersDrawerSummaryItem,
} from '#components/Shared/OrdersDrawer';
import { useBacktest } from '#store';
import { useTestContext } from '../context';

const BACKTEST_ORDER_ROW_HEIGHT = 254;

const EXIT_ORDER_TYPES = new Set([
  'CLOSE_LONG',
  'CLOSE_SHORT',
  'TAKE_PROFIT_LONG',
  'TAKE_PROFIT_SHORT',
  'STOP_LOSS_LONG',
  'STOP_LOSS_SHORT',
]);

const isExitOrder = (order: OrderLogData[number]) =>
  EXIT_ORDER_TYPES.has(order.type);

const formatOrderType = (type: OrderLogData[number]['type']) =>
  type.replaceAll('_', ' ');

const getOrderStatus = (type: OrderLogData[number]['type']) => {
  if (type.startsWith('OPEN')) {
    return { label: 'OPEN', color: 'orange' };
  }

  if (type.startsWith('TAKE_PROFIT')) {
    return { label: 'TP', color: 'teal' };
  }

  if (type.startsWith('STOP_LOSS')) {
    return { label: 'SL', color: 'red' };
  }

  return { label: 'CLOSE', color: 'gray' };
};

const buildBacktestSummaryItems = (
  orders: OrderLogData,
): OrdersDrawerSummaryItem[] => {
  const closedOrders = orders.filter(isExitOrder);
  const winningOrders = closedOrders.filter(
    (order) =>
      typeof order.profit === 'number' &&
      Number.isFinite(order.profit) &&
      order.profit > 0,
  );
  const sumPnl = (direction: OrderLogData[number]['direction']) =>
    orders.reduce((total, order) => {
      if (
        order.direction !== direction ||
        typeof order.profit !== 'number' ||
        !Number.isFinite(order.profit)
      ) {
        return total;
      }

      return total + order.profit;
    }, 0);
  const winRate =
    closedOrders.length > 0
      ? (winningOrders.length / closedOrders.length) * 100
      : 0;
  const longPnl = sumPnl('LONG');
  const shortPnl = sumPnl('SHORT');

  return [
    {
      title: 'Total Closed Orders',
      value: formatInteger(closedOrders.length),
    },
    {
      title: 'Win Rate',
      value: formatPercent(winRate),
    },
    {
      title: 'P&L of Closed Long Orders (USDT)',
      value: formatSignedNumber(longPnl),
      color: getPnlColor(longPnl),
    },
    {
      title: 'P&L of Closed Short Orders (USDT)',
      value: formatSignedNumber(shortPnl),
      color: getPnlColor(shortPnl),
    },
  ];
};

const mapBacktestOrder = (order: OrderLogData[number]): OrdersDrawerOrder => {
  const status = getOrderStatus(order.type);

  return {
    id: `${order.index}:${order.timestamp}:${order.type}`,
    title: order.symbol,
    period: {
      start: order.timestamp,
    },
    direction: order.direction,
    statusLabel: status.label,
    statusColor: status.color,
    pnl: order.profit,
    accentColor: order.type.startsWith('OPEN')
      ? 'orange.300'
      : getPnlColor(order.profit),
    metrics: [
      {
        title: 'Price',
        value: formatCompactNumber(order.price),
      },
      {
        title: 'Qty',
        value: formatCompactNumber(order.qty),
      },
      {
        title: 'Notional',
        value: formatCompactNumber(order.amount, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }),
      },
      {
        title: 'Fee',
        value: formatFee(order.fee ?? null),
      },
      {
        title: 'Type',
        value: formatOrderType(order.type),
        color: order.type.startsWith('OPEN') ? 'orange.300' : 'gray.300',
      },
      {
        title: 'Index',
        value: formatInteger(order.index),
      },
    ],
  };
};

export const TestCardOrdersDrawer = () => {
  const [open, setOpen] = useState(false);
  const {
    testResult: { test },
  } = useTestContext();
  const { backtest, loading } = useBacktest(open ? test.name : undefined);
  const orders = useMemo(() => backtest.map(mapBacktestOrder), [backtest]);
  const summaryItems = useMemo(
    () => buildBacktestSummaryItems(backtest),
    [backtest],
  );

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Orders
      </Button>
      <OrdersDrawerPanel
        title={`${test.symbol} orders`}
        open={open}
        orders={orders}
        summaryItems={summaryItems}
        rowHeight={BACKTEST_ORDER_ROW_HEIGHT}
        emptyText={
          loading ? 'Loading orders...' : 'No orders for this backtest.'
        }
        onOpenChange={setOpen}
      />
    </>
  );
};
