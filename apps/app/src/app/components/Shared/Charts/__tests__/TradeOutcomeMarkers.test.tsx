import { render, screen } from '@testing-library/react';
import {
  buildBacktestTradeOutcomePoints,
  buildEquityTradeOutcomePoints,
  normalizeTradeOutcomePoints,
  buildSnapshotTradeOutcomePoints,
  TradeOutcomeMarkers,
} from '../TradeOutcomeMarkers';

jest.mock('recharts', () => ({
  ReferenceDot: ({ fill, x, y }: { fill: string; x: number; y: number }) => (
    <span
      data-testid="trade-outcome-marker"
      data-fill={fill}
      data-x={x}
      data-y={y}
    />
  ),
}));

describe('trade outcome chart markers', () => {
  it('builds one marker per non-flat equity step', () => {
    expect(
      buildEquityTradeOutcomePoints([
        [1, 100],
        [2, 112],
        [3, 107],
        [4, 107],
      ]),
    ).toEqual([
      { timestamp: 2, equity: 112, pnl: 12 },
      { timestamp: 3, equity: 107, pnl: -5 },
    ]);
  });

  it('keeps valid wins and losses while dropping flat or incomplete points', () => {
    expect(
      normalizeTradeOutcomePoints([
        { timestamp: 10, equity: 101, pnl: 1 },
        { timestamp: 20, equity: 99, pnl: -2 },
        { timestamp: 30, equity: 99, pnl: 0 },
        { timestamp: null, equity: 100, pnl: 1 },
      ]),
    ).toEqual([
      { timestamp: 10, equity: 101, pnl: 1 },
      { timestamp: 20, equity: 99, pnl: -2 },
    ]);
  });

  it('uses only closed snapshot orders', () => {
    expect(
      buildSnapshotTradeOutcomePoints([
        { id: 'open', exitTimestamp: null, equityAfter: 100, pnl: -0.1 },
        { id: 'win', exitTimestamp: 20, equityAfter: 105, pnl: 5 },
      ]),
    ).toEqual([{ timestamp: 20, equity: 105, pnl: 5 }]);
  });

  it('uses only closing backtest orders', () => {
    expect(
      buildBacktestTradeOutcomePoints([
        {
          type: 'OPEN_LONG',
          timestamp: 10,
          amount: 99.9,
          profit: -0.1,
        },
        {
          type: 'CLOSE_LONG',
          timestamp: 20,
          amount: 104,
          profit: 4.1,
        },
      ] as Parameters<typeof buildBacktestTradeOutcomePoints>[0]),
    ).toEqual([{ timestamp: 20, equity: 104, pnl: 4.1 }]);
  });

  it('renders wins green and losses red', () => {
    render(
      <TradeOutcomeMarkers
        points={[
          { timestamp: 10, equity: 101, pnl: 1 },
          { timestamp: 20, equity: 99, pnl: -2 },
        ]}
        positiveColor="green"
        negativeColor="red"
      />,
    );

    const markers = screen.getAllByTestId('trade-outcome-marker');
    expect(markers[0].getAttribute('data-fill')).toBe('green');
    expect(markers[1].getAttribute('data-fill')).toBe('red');
  });
});
