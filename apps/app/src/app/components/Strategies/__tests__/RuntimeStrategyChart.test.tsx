import React from 'react';
import { render, screen } from '@testing-library/react';
import type { StrategyEvidenceTimeline, TestStat } from '@tradejs/types';
import { RuntimeStrategyChart } from '../RuntimeStrategyChart';

const referenceLineMock = jest.fn();

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
    ReferenceLine: (props: unknown) => {
      referenceLineMock(props);
      return null;
    },
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

jest.mock('../StrategyEvidencePopover', () => ({
  STRATEGY_EVIDENCE_MARKER_PRESENTATION: {
    G: { color: 'purple.400' },
    L: { color: 'orange.400' },
    E: { color: 'teal.400' },
    D: { color: 'blue.400' },
    P: { color: 'cyan.400' },
    R: { color: 'pink.400' },
  },
  filterStrategyEvidenceMarkers: ({ markers }: { markers: unknown[] }) =>
    markers,
  StrategyEvidencePopover: ({
    timeline,
  }: {
    timeline: StrategyEvidenceTimeline;
  }) => <button>Evidence {timeline.status}</button>,
}));

const stat = {
  maxAmount: 100,
  minAmount: 100,
} as TestStat;

describe('RuntimeStrategyChart immutable evidence seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps explicit evidence available when the card has no trades', () => {
    render(
      <RuntimeStrategyChart
        orderLog={[]}
        stat={stat}
        evidenceTimeline={{
          status: 'missing',
          observedFrom: null,
          markers: [],
        }}
        startTimestamp={100}
        endTimestamp={200}
      />,
    );

    expect(screen.getByText('Evidence missing')).toBeTruthy();
    expect(
      screen.getByText('No runtime trades for the selected window.'),
    ).toBeTruthy();
  });

  it('renders event lines only for a verified evidence timeline', () => {
    const marker = {
      id: 'gate-1',
      type: 'G' as const,
      timestamp: 150,
      label: 'Composition frozen',
      summary: 'Frozen composition',
      artifactId: 'artifact-1',
      artifactSha256: 'a'.repeat(64),
    };
    const renderChart = (evidenceTimeline: StrategyEvidenceTimeline) =>
      render(
        <RuntimeStrategyChart
          orderLog={[
            [100, 100],
            [200, 101],
          ]}
          stat={stat}
          evidenceTimeline={evidenceTimeline}
          startTimestamp={100}
          endTimestamp={200}
        />,
      );

    const invalid = renderChart({
      status: 'invalid',
      observedFrom: null,
      markers: [marker],
    });
    expect(
      referenceLineMock.mock.calls.map(([props]) => props.x).filter(Boolean),
    ).toEqual([]);
    invalid.unmount();
    referenceLineMock.mockClear();

    renderChart({ status: 'verified', observedFrom: 100, markers: [marker] });
    expect(
      referenceLineMock.mock.calls.map(([props]) => props.x).filter(Boolean),
    ).toEqual([150]);
  });
});
