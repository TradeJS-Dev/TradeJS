'use client';

import { Text, Flex } from '@chakra-ui/react';
import { useTest } from '../context';

export const TestTitle = () => {
  const { id, test } = useTest();

  if (!test || !test.stat) {
    return null;
  }

  return (
    <Flex gap="4">
      <Text fontSize="lg" fontWeight="bold" color={'teal.500'} mb={4}>
        {test.stat.score}
      </Text>

      <Text fontSize="lg" fontWeight="bold" mb={4}>
        {id}
      </Text>
    </Flex>
  );
};
