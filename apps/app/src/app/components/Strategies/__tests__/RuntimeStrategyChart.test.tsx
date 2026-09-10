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
      stroke,
    }: {
      x?: number;
      label?: { value?: string };
      stroke?: string;
    }) =>
      x == null ? null : (
        <div
          data-testid="revision-line"
          data-timestamp={x}
          data-label={label?.value}
          data-stroke={stroke}
        >
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

  it('renders unlabeled vertical lines for strategy revision changes', () => {
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
            kind: 'strategy_package',
          },
          {
            timestamp: 175,
            strategyRevision: 'sr1:2222222222222222',
            kind: 'other',
          },
        ]}
        stat={stat}
        startTimestamp={100}
        endTimestamp={200}
      />,
    );

    expect(screen.getAllByTestId('revision-line')).toHaveLength(2);
    for (const line of screen.getAllByTestId('revision-line')) {
      expect(line.getAttribute('data-label')).toBeNull();
    }
    expect(
      screen
        .getAllByTestId('revision-line')
        .map((line) => line.getAttribute('data-stroke')),
    ).toEqual(['red.400', 'orange.400']);
  });
});
