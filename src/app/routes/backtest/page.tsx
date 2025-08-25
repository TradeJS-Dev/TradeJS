'use client';

import React from 'react';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
// import { SelectSymbol } from '@shared/Filters';
import { CompareList } from '@components/Backtest/CompareList';
import { TestsList } from '@components/Backtest/TestsList';

const Backtest = () => {
  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.900">
        <Box
          as="main"
          minH="100vh"
          minW="1200px"
          pl={2}
          bg="gray.900"
          display="flex"
          flexDirection="column"
          justifyContent="sspace-between"
          alignItems="flex-start"
        >
          <Flex mb={4} gap={8} flexDirection="row">
            <CompareList />
          </Flex>
          <Box flex="1" h="full" w="full">
            <TestsList />
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Backtest;
