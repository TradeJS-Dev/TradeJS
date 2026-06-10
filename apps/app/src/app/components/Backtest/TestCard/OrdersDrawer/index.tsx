'use client';

import { useMemo, useState } from 'react';
import { Button } from '@chakra-ui/react';
import type { OrderLogData } from '@tradejs/types';
import {
  formatCompactNumber,
  formatFee,
  formatInteger,
  getPnlColor,
  OrdersDrawerPanel,
  type OrdersDrawerOrder,
} from '#components/Shared/OrdersDrawer';
import { useBacktest } from '#store';
import { useTestContext } from '../context';

const BACKTEST_ORDER_ROW_HEIGHT = 254;

const backtestStatusFilterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'active' },
  { label: 'Closed', value: 'closed' },
] as const;

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

const mapBacktestOrder = (order: OrderLogData[number]): OrdersDrawerOrder => {
  const status = getOrderStatus(order.type);

  return {
    id: `${order.index}:${order.timestamp}:${order.type}`,
    title: order.symbol,
    period: {
      start: order.timestamp,
    },
    direction: order.direction,
    status: order.type.startsWith('OPEN') ? 'active' : 'closed',
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
        value: formatCompactNumber(order.price * order.qty, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }),
      },
      {
        title: 'Fee',
        value: formatFee(order.fee ?? null),
      },
      {
        title: 'Equity',
        value: formatCompactNumber(order.amount, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }),
      },
      {
        title: 'Index',
        value: formatInteger(order.index),
      },
    ],
  };
};

interface TestCardOrdersDrawerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TestCardOrdersDrawerPanel = ({
  open,
  onOpenChange,
}: TestCardOrdersDrawerPanelProps) => {
  const {
    testResult: { test },
  } = useTestContext();
  const { backtest, loading } = useBacktest(open ? test.name : undefined);
  const orders = useMemo(() => backtest.map(mapBacktestOrder), [backtest]);

  return (
    <OrdersDrawerPanel
      title={`${test.symbol} orders`}
      open={open}
      orders={orders}
      rowHeight={BACKTEST_ORDER_ROW_HEIGHT}
      statusFilterOptions={backtestStatusFilterOptions}
      emptyText={loading ? 'Loading orders...' : 'No orders for this backtest.'}
      onOpenChange={onOpenChange}
    />
  );
};

export const TestCardOrdersDrawer = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Orders
      </Button>
      <TestCardOrdersDrawerPanel open={open} onOpenChange={setOpen} />
    </>
  );
};
