import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RuntimeStrategyView } from '@tradejs/types';
import { RuntimeStrategyCard } from '../RuntimeStrategyCard';

jest.mock('@chakra-ui/react', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Button = ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>;
  const MenuItem = ({
    children,
    onClick,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button role="menuitem" onClick={onClick}>
      {children}
    </button>
  );

  return {
    Badge: passthrough,
    Box: passthrough,
    Button,
    Flex: passthrough,
    Menu: {
      Root: passthrough,
      Trigger: passthrough,
      Positioner: passthrough,
      Content: passthrough,
      Item: MenuItem,
    },
    Portal: passthrough,
    SimpleGrid: passthrough,
    Stat: {
      Root: passthrough,
      Label: passthrough,
      ValueText: passthrough,
    },
    Text: passthrough,
  };
});

jest.mock('@tradejs/core/backtest', () => ({
  getFormatted: () => ({ formatted: '0', level: 'neutral' }),
}));

jest.mock('#components/Shared/OrdersDrawer', () => ({
  formatDateTime: () => 'date',
  OrdersDrawerPanel: () => null,
}));

jest.mock('../RuntimeStrategyCard.presenter', () => ({
  buildRuntimeStrategyCardViewModel: () => ({
    lastTrade: null,
    runtimeOrders: [],
  }),
  getColorByLevel: () => 'gray.300',
  RUNTIME_ORDER_ROW_HEIGHT: 100,
}));

jest.mock('../RuntimeStrategyChart', () => ({
  RuntimeStrategyChart: () => null,
}));

jest.mock('../RuntimeStrategyConfigDrawer', () => ({
  RuntimeStrategyConfigDrawer: () => null,
}));

jest.mock('../RuntimeStrategyStatsDrawer', () => ({
  RuntimeStrategyStatsDrawer: () => null,
}));

jest.mock('../RuntimeStrategyRevisionsDrawer', () => ({
  RuntimeStrategyRevisionsDrawer: ({ open }: { open: boolean }) =>
    open ? <div>Revisions drawer open</div> : null,
}));

jest.mock('#ui', () => ({
  toaster: { error: jest.fn(), success: jest.fn() },
}));

const strategy = {
  strategyName: 'DoubleTap',
  strategyModule: '@tradejs/strategy-double-tap-forward',
  strategyPackage: '@tradejs/strategy-double-tap-forward',
  strategyPackageVersion: '3.2.1',
  strategyRevision: 'sr1:3333333333333333',
  generation: 'candidate',
  deploymentId: 'production',
  deploymentLabel: 'Forward',
  accountLabel: 'Bybit forward',
  controlState: 'active',
  enabled: true,
  connected: true,
  universe: 'crypto',
  interval: 15,
  config: { MAX_LOSS_VALUE: 1 },
  summary: { totalTrades: 5, activeTrades: 2 },
  stat: {},
  orderLog: [],
  revisionChanges: [],
} as unknown as RuntimeStrategyView;

describe('RuntimeStrategyCard', () => {
  it('shows the deployment, account, version, generation, and risk identity', () => {
    render(
      <RuntimeStrategyCard
        strategy={strategy}
        provider="bybit"
        startTimestamp={100}
        endTimestamp={200}
        onUpdated={jest.fn()}
      />,
    );

    expect(screen.getByText('Forward')).toBeTruthy();
    expect(screen.getByText('account: Bybit forward')).toBeTruthy();
    expect(screen.getByText('version: 3.2.1')).toBeTruthy();
    expect(screen.getByText('generation: candidate')).toBeTruthy();
    expect(screen.getByText('max loss: 1')).toBeTruthy();
  });

  it('keeps Revisions last in Actions and opens its drawer', () => {
    render(
      <RuntimeStrategyCard
        strategy={strategy}
        provider="bybit"
        startTimestamp={100}
        endTimestamp={200}
        onUpdated={jest.fn()}
      />,
    );

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((item) => item.textContent)).toEqual([
      'View config',
      'Pause new entries',
      'Orders',
      'Stat',
      'Revisions',
    ]);

    fireEvent.click(menuItems.at(-1)!);
    expect(screen.getByText('Revisions drawer open')).toBeTruthy();
  });
});
