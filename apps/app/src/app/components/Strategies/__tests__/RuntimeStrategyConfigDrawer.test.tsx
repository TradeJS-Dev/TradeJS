import React from 'react';
import { render, screen } from '@testing-library/react';
import type { RuntimeStrategyView } from '@tradejs/types';
import { RuntimeStrategyConfigDrawer } from '../RuntimeStrategyConfigDrawer';

const clipboardRootMock = jest.fn();

jest.mock('@chakra-ui/react', () => {
  const React = require('react');

  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const DrawerRoot = ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? <div>{children}</div> : null);
  const ClipboardRoot = ({
    children,
    value,
  }: {
    children?: React.ReactNode;
    value: string;
  }) => {
    clipboardRootMock(value);
    return <div>{children}</div>;
  };
  const Button = ({
    children,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    'aria-label'?: string;
  }) => <button aria-label={ariaLabel}>{children}</button>;
  const Textarea = ({ value }: { value: string }) => (
    <textarea readOnly value={value} />
  );

  return {
    Box: passthrough,
    Button,
    Clipboard: {
      Root: ClipboardRoot,
      Trigger: passthrough,
      Indicator: () => <span>copy</span>,
    },
    CloseButton: Button,
    Drawer: {
      Root: DrawerRoot,
      Backdrop: passthrough,
      Positioner: passthrough,
      Content: passthrough,
      Header: passthrough,
      Title: passthrough,
      CloseTrigger: passthrough,
      Body: passthrough,
      Footer: passthrough,
    },
    Flex: passthrough,
    IconButton: Button,
    Portal: passthrough,
    SimpleGrid: passthrough,
    Text: passthrough,
    Textarea,
  };
});

const strategy = {
  runtimeKey: 'production:DoubleTap:sr1:5555555555555555',
  strategyName: 'DoubleTap',
  configId: 'DoubleTap:production',
  strategyRevision: 'sr1:5555555555555555',
  controlState: 'active',
  interval: 15,
  universe: 'crypto',
  accountId: 'bybit-main',
  accountLabel: 'Bybit main',
  deploymentId: 'production',
  policyProfileId: 'crypto',
  connected: true,
  enabled: true,
  config: { takeProfit: 3, stopLoss: 1 },
  symbols: ['BTCUSDT', 'ETHUSDT'],
  summary: {
    totalTrades: 12,
    activeTrades: 2,
    closedTrades: 10,
  },
} as unknown as RuntimeStrategyView;

describe('RuntimeStrategyConfigDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows runtime identity and useful operational details', () => {
    render(
      <RuntimeStrategyConfigDrawer
        open
        strategy={strategy}
        provider="bybit"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText('sr1:5555555555555555')).toBeTruthy();
    expect(screen.queryByText('Config ID')).toBeNull();
    expect(screen.queryByText('DoubleTap:production')).toBeNull();
    expect(
      screen.getByText('production:DoubleTap:sr1:5555555555555555'),
    ).toBeTruthy();
    expect(screen.getByText('Bybit main')).toBeTruthy();
    expect(screen.getByText('bybit-main')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('BTCUSDT, ETHUSDT')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('provides the complete formatted config to the copy control', () => {
    render(
      <RuntimeStrategyConfigDrawer
        open
        strategy={strategy}
        provider="bybit"
        onOpenChange={jest.fn()}
      />,
    );

    const config = JSON.stringify(strategy.config, null, 2);
    expect(clipboardRootMock).toHaveBeenCalledWith(config);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      config,
    );
    expect(
      screen.getByRole('button', { name: 'Copy strategy config' }),
    ).toBeTruthy();
  });
});
