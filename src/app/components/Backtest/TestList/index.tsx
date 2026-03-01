'use client';

import { useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { FiFolder } from 'react-icons/fi';
import { Box, Code } from '@chakra-ui/react';
import { TestCard } from '@components/Backtest/TestCard';
import { EmptyState } from '@UI';
import { Items } from '@types';

interface ListProps {
  tests: Items;
  loadding: boolean;
  fulFilled: boolean;
  noData: boolean;
  overscan?: number;
}

const ITEM_HEIGHT = 548;

export const TestList = ({
  tests,
  loadding,
  fulFilled,
  noData,
  overscan = 2,
}: ListProps) => {
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
            <TestCard.Title>
              <TestCard.CompareButton />
              <TestCard.FavoriteIndicator />
              <TestCard.ConfigDrawer />
              <TestCard.OpenDashboardButton />
              <TestCard.OpenReportButton />
              <TestCard.DeleteButton />
            </TestCard.Title>
            <TestCard.Chart />
            <TestCard.StatLine />
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
            Please run
            <Code ml={1} colorPalette="teal" variant="subtle">
              yarn backtest --help
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
