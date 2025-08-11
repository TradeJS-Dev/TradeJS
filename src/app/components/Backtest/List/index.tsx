'use client';

import { useState } from 'react';
import {
  TestCard,
  TestCompareList,
  OnChangeCompare,
} from '@/src/app/components/Backtest/TestCard';
import { Items } from '@types';

interface ListProps {
  files: Items;
}

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

export const List = ({ files }: ListProps) => {
  const [compareList, setCompareList] = useState<TestCompareList>([]);

  const onChangeCompare: OnChangeCompare = (testId, orderLog) => {
    setCompareList((state) => {
      if (orderLog) {
        const newState = [
          ...state,
          {
            testId,
            orderLog,
            color: colors[state.length],
          },
        ];

        if (newState.length > colors.length) {
          newState.shift();
        }

        return newState;
      } else {
        return state.filter((testCompare) => testCompare.testId !== testId);
      }
    });
  };

  return (
    <>
      {files.map((item, index) => (
        <TestCard.Root
          key={index}
          id={item.value}
          compareList={compareList}
          onChangeCompare={onChangeCompare}
        >
          <TestCard.Title />
          <TestCard.Chart />
          <TestCard.Stat />
        </TestCard.Root>
      ))}
    </>
  );
};
