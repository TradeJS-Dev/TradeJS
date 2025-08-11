'use client';

import { Text, Flex, IconButton } from '@chakra-ui/react';
import { TbArrowsLeftRight } from 'react-icons/tb';
import { useTestResult } from '../context';
import { TaskCardConfigDrawer } from '../ConfigDrawer';

export const TestCardTitle = () => {
  const {
    testResult: { stat, test, orderLog },
    compareList,
    onChangeCompare,
  } = useTestResult();

  const isCompared = compareList.some(
    (compare) => compare.testId === test.testId,
  );

  return (
    <Flex gap="4" p={4} mb={3}>
      <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
        {test.symbol}
      </Text>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          score:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'teal.500'}>
          {stat.score}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          strategy:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.strategyName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          connector:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.connectorName}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          suite Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.testSuiteId}
        </Text>
      </Flex>

      <Flex gap="1">
        <Text fontSize="sm" fontWeight="bold" color={'gray.400'} mt={1}>
          test Id:
        </Text>

        <Text fontSize="lg" fontWeight="bold" color={'gray.200'}>
          {test.testId}
        </Text>
      </Flex>

      <Flex gap="2" mt={-1}>
        <IconButton
          size="xs"
          colorPalette="teal"
          variant={isCompared ? 'solid' : 'outline'}
          onClick={() =>
            isCompared
              ? onChangeCompare(test.testId, null)
              : onChangeCompare(test.testId, orderLog)
          }
        >
          <TbArrowsLeftRight />
        </IconButton>
        <TaskCardConfigDrawer />
      </Flex>
    </Flex>
  );
};
