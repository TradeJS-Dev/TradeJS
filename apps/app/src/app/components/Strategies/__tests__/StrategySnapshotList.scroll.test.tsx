import { render } from '@testing-library/react';
import type { StrategyChartSnapshot } from '@tradejs/types';
import { StrategySnapshotList } from '../StrategySnapshotList';

jest.mock('@chakra-ui/react', () => ({
  Box: ({
    children,
    style,
  }: {
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) => <div style={style}>{children}</div>,
}));

jest.mock('react-virtualized-auto-sizer', () => ({
  __esModule: true,
  default: ({
    children,
  }: {
    children: (size: { height: number; width: number }) => React.ReactNode;
  }) => children({ height: 1240, width: 1000 }),
}));

jest.mock('../StrategySnapshotCard', () => ({
  StrategySnapshotCard: ({ snapshot }: { snapshot: StrategyChartSnapshot }) => (
    <div data-testid={`snapshot-card-${snapshot.cardId}`} />
  ),
}));

describe('StrategySnapshotList scrolling', () => {
  it('keeps replay cards in the page scroll flow', () => {
    const { container } = render(
      <StrategySnapshotList
        strategies={[
          { cardId: 'replay-1' } as StrategyChartSnapshot,
          { cardId: 'replay-2' } as StrategyChartSnapshot,
        ]}
        mode="replay"
        selectedCardIds={new Set()}
        emptyText="No replay trades"
        onDeleted={jest.fn()}
        onToggleSelection={jest.fn()}
      />,
    );

    const nestedVerticalScrollers = [...container.querySelectorAll('*')].filter(
      (element) => {
        const style = window.getComputedStyle(element);
        return style.overflowY === 'auto' || style.overflow === 'auto';
      },
    );

    expect(nestedVerticalScrollers).toHaveLength(0);
  });
});
