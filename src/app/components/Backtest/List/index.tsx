'use client';

import { useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { Box } from '@chakra-ui/react';
import { TestCard } from '@/src/app/components/Backtest/TestCard';
import { CompareList } from './CompareList';
import { Items } from '@types';

interface ListProps {
  files: Items;
  overscan?: number;
}

const ITEM_HEIGHT = 648;

export const List = ({ files, overscan = 2 }: ListProps) => {
  const itemKey = useCallback(
    (index: number) => files[index]?.value ?? String(index),
    [files],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = files[index];
      return (
        <Box style={style} px={2}>
          <TestCard.Root key={item.value} id={item.value}>
            <TestCard.Title />
            <TestCard.Chart />
            <TestCard.Stat />
          </TestCard.Root>
        </Box>
      );
    },
    [files],
  );

  return (
    <>
      <CompareList />
      <AutoSizer>
        {({ height: h, width }) => (
          <FixedSizeList
            height={h}
            width={width}
            itemCount={files.length}
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
