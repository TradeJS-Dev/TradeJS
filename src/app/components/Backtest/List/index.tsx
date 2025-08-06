'use client';

import { Test } from '@app/components/Backtest/Test';
import { Items } from '@types';

interface ListProps {
  files: Items;
}

export const List = ({ files }: ListProps) => {
  return (
    <>
      {files.map((item, index) => (
        <Test.Root key={index} id={item.value}>
          <Test.Title />
          <Test.Chart />
          <Test.Stat />
        </Test.Root>
      ))}
    </>
  );
};
