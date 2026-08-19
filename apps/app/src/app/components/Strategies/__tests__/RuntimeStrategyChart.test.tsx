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
    ReferenceLine: () => null,
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
});
