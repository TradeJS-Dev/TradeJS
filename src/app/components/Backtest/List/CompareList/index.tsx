import { For, Tag, HStack } from '@chakra-ui/react';
import _ from 'lodash';
import {
  TestCompareList,
  OnChangeCompare,
} from '@/src/app/components/Backtest/TestCard';

interface CompareListProps {
  compareList: TestCompareList;
  onChangeCompare: OnChangeCompare;
}

export const CompareList = ({
  compareList,
  onChangeCompare,
}: CompareListProps) => {
  if (_.isEmpty(compareList)) {
    return null;
  }

  return (
    <HStack p={2} mb={2} gap={4}>
      <For each={compareList}>
        {(test) => (
          <Tag.Root key={test.testId} size="lg" colorPalette="teal">
            <Tag.Label>{test.testId}</Tag.Label>
            <Tag.EndElement>
              <Tag.CloseTrigger
                onClick={() => onChangeCompare(test.testId, null)}
              />
            </Tag.EndElement>
          </Tag.Root>
        )}
      </For>
    </HStack>
  );
};
