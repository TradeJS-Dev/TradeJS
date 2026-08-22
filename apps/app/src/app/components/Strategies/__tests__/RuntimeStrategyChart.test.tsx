import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TestStat } from '@tradejs/types';
import { RuntimeStrategyChart } from '../RuntimeStrategyChart';

jest.mock('@chakra-ui/react', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return { Box: passthrough, Flex: passthrough, Text: passthrough };
});

jest.mock('@chakra-ui/charts', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Chart: { Root: passthrough, Tooltip: passthrough },
    useChart: (value: unknown) => ({
      ...(value as object),
      color: (color: string) => color,
      key: (key: unknown) => key,
    }),
  };
});

jest.mock('recharts', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    CartesianGrid: () => null,
    Line: () => null,
    LineChart: passthrough,
    ReferenceLine: ({
      x,
      label,
    }: {
      x?: number;
      label?: { value?: string };
    }) =>
      x == null ? null : (
        <div data-testid="revision-line" data-timestamp={x}>
          {label?.value}
        </div>
      ),
    ResponsiveContainer: passthrough,
    Tooltip: () => null,
    YAxis: () => null,
  };
});

jest.mock('@tradejs/core/backtest', () => ({
  getFormatted: () => ({ formatted: '0' }),
}));

jest.mock('#shared/Charts/TimeSeriesXAxis', () => ({
  TimeSeriesXAxis: () => null,
}));

jest.mock('#shared/Charts/TradeOutcomeMarkers', () => ({
  buildEquityTradeOutcomePoints: () => [],
  TradeOutcomeMarkers: () => null,
}));

const stat = { maxAmount: 100, minAmount: 100 } as TestStat;

describe('RuntimeStrategyChart', () => {
  it('renders runtime state without an evidence dependency', () => {
    render(
      <RuntimeStrategyChart
        orderLog={[]}
        stat={stat}
        startTimestamp={100}
        endTimestamp={200}
      />,
    );

    expect(
      screen.getByText('No runtime trades for the selected window.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Evidence/)).toBeNull();
  });

  it('renders strategy revision changes as vertical reference lines', () => {
    render(
      <RuntimeStrategyChart
        orderLog={[
          [100, 100],
          [200, 101],
        ]}
        revisionChanges={[
          {
            timestamp: 150,
            strategyRevision: 'sr1:1111111111111111',
          },
          {
            timestamp: 175,
            strategyRevision: 'sr1:2222222222222222',
          },
        ]}
        stat={stat}
        startTimestamp={100}
        endTimestamp={200}
      />,
    );

    expect(screen.getAllByTestId('revision-line')).toHaveLength(2);
    expect(screen.getByText('Revision 11111111')).toBeTruthy();
    expect(screen.getByText('Revision 22222222')).toBeTruthy();
  });
});
