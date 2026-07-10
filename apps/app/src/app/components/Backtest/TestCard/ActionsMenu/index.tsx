'use client';

import { useState } from 'react';
import { Button, Menu, Portal } from '@chakra-ui/react';
import { useFavoriteTests, useTestsCompare } from '#store';
import { TestCardConfigDrawerPanel } from '../ConfigDrawer';
import { TestCardDeleteDialog } from '../DeleteButton';
import { TestCardOrdersDrawerPanel } from '../OrdersDrawer';
import { TestCardStatDrawerPanel } from '../StatDrawer';
import { useTestContext } from '../context';

const connectorNameToProvider: Record<
  string,
  'bybit' | 'binance' | 'coinbase'
> = {
  bybit: 'bybit',
  binance: 'binance',
  coinbase: 'coinbase',
};

export const TestCardActionsMenu = () => {
  const [configOpen, setConfigOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [statOpen, setStatOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { testResult } = useTestContext();
  const { checkIsCompared, onChangeCompare } = useTestsCompare();
  const { checkIsFavorite, toggleFavorite } = useFavoriteTests();
  const isCompared = checkIsCompared(testResult.test.name);
  const isFavorite = checkIsFavorite(testResult.test.name);

  const openDashboard = () => {
    const provider =
      connectorNameToProvider[testResult.test.connectorName.toLowerCase()] ||
      'bybit';
    const params = new URLSearchParams();

    params.set('backtestId', testResult.test.name);
    params.set('backtestStrategy', testResult.test.strategyName);

    window.open(
      `/routes/dashboard/${provider}/${testResult.test.universe ?? 'crypto'}/${testResult.test.symbol}/${testResult.test.interval ?? '15'}?${params.toString()}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

  return (
    <>
      <Menu.Root positioning={{ placement: 'bottom-end' }}>
        <Menu.Trigger asChild>
          <Button size="sm" variant="outline">
            Actions
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content minW="180px">
              <Menu.Item
                value="compare"
                onClick={() => onChangeCompare(testResult.test.name)}
              >
                {isCompared ? 'Remove compare' : 'Compare'}
              </Menu.Item>
              <Menu.Item
                value="favorite"
                onClick={() =>
                  toggleFavorite(
                    testResult.test.name,
                    testResult.stat.netProfit,
                  )
                }
              >
                {isFavorite ? 'Unfavorite' : 'Favorite'}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item value="config" onClick={() => setConfigOpen(true)}>
                Config
              </Menu.Item>
              <Menu.Item value="orders" onClick={() => setOrdersOpen(true)}>
                Orders
              </Menu.Item>
              <Menu.Item value="stat" onClick={() => setStatOpen(true)}>
                Stat
              </Menu.Item>
              <Menu.Item value="dashboard" onClick={openDashboard}>
                Dashboard
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="delete"
                color="fg.error"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <TestCardConfigDrawerPanel
        open={configOpen}
        onOpenChange={setConfigOpen}
      />
      <TestCardOrdersDrawerPanel
        open={ordersOpen}
        onOpenChange={setOrdersOpen}
      />
      <TestCardStatDrawerPanel open={statOpen} onOpenChange={setStatOpen} />
      <TestCardDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  );
};
