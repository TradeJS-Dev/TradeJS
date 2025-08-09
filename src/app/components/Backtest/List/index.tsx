'use client';

import { TestCard } from '@/src/app/components/Backtest/TestCard';
import { Items } from '@types';

interface ListProps {
  files: Items;
}

export const List = ({ files }: ListProps) => {
  return (
    <>
      {files.map((item, index) => (
        <TestCard.Root key={index} id={item.value}>
          <TestCard.Title />
          <TestCard.Chart />
          <TestCard.Stat />
        </TestCard.Root>
      ))}
    </>
  );
};
