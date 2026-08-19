'use client';

import { useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { Box } from '@chakra-ui/react';
import type { StrategyChartSnapshot } from '@tradejs/types';
import { StrategySnapshotCard } from './StrategySnapshotCard';

const REPLAY_SNAPSHOT_CARD_ROW_HEIGHT = 620;
const AI_SNAPSHOT_CARD_ROW_HEIGHT = 548;

export const getSnapshotCardRowHeight = (mode: 'replay' | 'ai') =>
  mode === 'ai' ? AI_SNAPSHOT_CARD_ROW_HEIGHT : REPLAY_SNAPSHOT_CARD_ROW_HEIGHT;

interface StrategySnapshotListProps {
  strategies: StrategyChartSnapshot[];
  mode: 'replay' | 'ai';
  selectedCardIds: ReadonlySet<string>;
  emptyText: string;
  onDeleted: (cardId: string) => void;
  onToggleSelection: (cardId: string, checked: boolean) => void;
  overscan?: number;
}

export const StrategySnapshotList = ({
  strategies,
  mode,
  selectedCardIds,
  emptyText,
  onDeleted,
  onToggleSelection,
  overscan = 1,
}: StrategySnapshotListProps) => {
  const itemKey = useCallback(
    (index: number) => strategies[index]?.cardId ?? String(index),
    [strategies],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const strategy = strategies[index];
      if (!strategy) {
        return null;
      }

      return (
        <Box style={style}>
          <StrategySnapshotCard
            snapshot={strategy}
            mode={mode}
            onDeleted={onDeleted}
            selected={selectedCardIds.has(strategy.cardId)}
            onToggleSelection={onToggleSelection}
            emptyText={emptyText}
          />
        </Box>
      );
    },
    [
      emptyText,
      mode,
      onDeleted,
      onToggleSelection,
      selectedCardIds,
      strategies,
    ],
  );

  return (
    <AutoSizer>
      {({ height, width }) => (
        <FixedSizeList
          height={height}
          width={width}
          itemCount={strategies.length}
          itemSize={getSnapshotCardRowHeight(mode)}
          overscanCount={overscan}
          itemKey={itemKey}
        >
          {Row}
        </FixedSizeList>
      )}
    </AutoSizer>
  );
};
