import { For, Tag, HStack, Text } from '@chakra-ui/react';
import _ from 'lodash';
import { useTestsCompare } from '@store';

export const CompareList = () => {
  const { compareList, onChangeCompare } = useTestsCompare();

  if (_.isEmpty(compareList)) {
    return (
      <HStack p={2} gap={4}>
        <Text color="gray.400">No compare tests</Text>
      </HStack>
    );
  }

  return (
    <HStack p={2} gap={4}>
      <For each={compareList}>
        {({ testResult, color }) => (
          <Tag.Root key={testResult.test.testId} size="lg" colorPalette={color}>
            <Tag.Label>
              {testResult.test.symbol}-{testResult.test.testId}
            </Tag.Label>
            <Tag.EndElement>
              <Tag.CloseTrigger
                onClick={() => onChangeCompare(testResult.test.name)}
              />
            </Tag.EndElement>
          </Tag.Root>
        )}
      </For>
    </HStack>
  );
};
