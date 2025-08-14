'use client';

import React, { useEffect, useState } from 'react';
import { Box, Flex, ClientOnly } from '@chakra-ui/react';
import { useFilters } from '@store';
import { getBacktestFiles } from '@src/actions/backtest';
// import { SelectSymbol } from '@app/components/Shared/Filters';
import { List } from '@app/components/Backtest/List';
import { Items } from '@types';

const Backtest = () => {
  const [files, setFiles] = useState<Items>([]);
  const { filters } = useFilters();

  useEffect(() => {
    getBacktestFiles({}).then(setFiles);
  }, [filters.symbol]);

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
          justifyContent="space-between"
          alignItems="flex-start"
        >
          <Flex mb={4} gap={8} flexDirection="row">
            {/* <SelectSymbol /> */}
          </Flex>
          <Box flex="1" h="full" w="full">
            <List files={files} />
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default Backtest;
