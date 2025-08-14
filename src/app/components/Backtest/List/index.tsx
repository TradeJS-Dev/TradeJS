'use client';

import { useState, useCallback, useRef } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList, ListChildComponentProps } from 'react-window';
import { Box } from '@chakra-ui/react';
import {
  TestCard,
  TestCompareList,
  OnChangeCompare,
} from '@/src/app/components/Backtest/TestCard';
import { CompareList } from './CompareList';
import { Items, TestResult } from '@types';

interface ListProps {
  files: Items;
  overscan?: number;
}

const ITEM_HEIGHT = 648;

const colors = [
  'purple',
  'pink',
  'red',
  'cyan',
  'orange',
  'yellow',
  'blue',
  'green',
];

export const List = ({ files, overscan = 2 }: ListProps) => {
  const [compareList, setCompareList] = useState<TestCompareList>([]);

  const onChangeCompare: OnChangeCompare = (testId, orderLog) => {
    setCompareList((state) => {
      if (orderLog) {
        const newState = [
          ...state,
          { testId, orderLog, color: colors[state.length] },
        ];
        if (newState.length > colors.length) newState.shift();
        return newState;
      }
      return state.filter((t) => t.testId !== testId);
    });
  };

  const itemKey = useCallback(
    (index: number) => files[index]?.value ?? String(index),
    [files],
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = files[index];
      return (
        <Box style={style} px={2}>
          <TestCard.Root
            key={item.value}
            id={item.value}
            compareList={compareList}
            onChangeCompare={onChangeCompare}
          >
            <TestCard.Title />
            <TestCard.Chart />
            <TestCard.Stat />
          </TestCard.Root>
        </Box>
      );
    },
    [files, compareList],
  );

  return (
    <>
      <CompareList
        compareList={compareList}
        onChangeCompare={onChangeCompare}
      />
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
