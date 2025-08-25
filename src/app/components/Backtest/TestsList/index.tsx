'use client';

import { useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { FiFolder } from 'react-icons/fi';
import { Box, Code } from '@chakra-ui/react';
import { useTestsList } from '@store';
import { TestCard } from '@components/Backtest/TestCard';
import { EmptyState } from '@UI';

interface ListProps {
  overscan?: number;
}

const ITEM_HEIGHT = 548;

export const TestsList = ({ overscan = 2 }: ListProps) => {
  const { tests, loadding, fulFilled, noData } = useTestsList();
  const itemKey = useCallback(
    (index: number) => tests[index]?.value ?? String(index),
    [tests],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = tests[index];
      return (
        <Box style={style} px={2}>
          <TestCard.Root key={item.value} testName={item.value}>
            <TestCard.Title />
            <TestCard.Chart />
            <TestCard.Stat />
          </TestCard.Root>
        </Box>
      );
    },
    [tests],
  );

  if (!fulFilled && loadding) {
    return (
      <>
        <TestCard.Skeleton />
        <TestCard.Skeleton />
      </>
    );
  }

  if (fulFilled && !loadding && noData) {
    return (
      <EmptyState
        icon={FiFolder}
        title="No tests found"
        description={
          <>
            Run
            <Code ml={1} variant="outline">
              yarn backtest
            </Code>
          </>
        }
      />
    );
  }

  return (
    <>
      <AutoSizer>
        {({ height: h, width }) => (
          <FixedSizeList
            height={h}
            width={width}
            itemCount={tests.length}
            itemSize={ITEM_HEIGHT}
            overscanCount={overscan}
            itemKey={itemKey}
          >
            {Row}
          </FixedSizeList>
        )}
      </AutoSizer>
    </>
  );
};
