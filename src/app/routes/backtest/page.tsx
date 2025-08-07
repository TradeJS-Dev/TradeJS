'use client';

import React, { useEffect, useState } from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useRecoilValue } from 'recoil';
import { filtersState } from '@atoms';
import { getBacktestFiles } from '@src/actions/backtest';
// import { SelectSymbol } from '@app/components/Shared/Filters';
import { List } from '@app/components/Backtest/List';
import { useIsClient } from '@app/hooks/isClient';
import { Items } from '@types';

const Dashboard = () => {
  const isClient = useIsClient();
  const [files, setFiles] = useState<Items>([]);
  const { symbol } = useRecoilValue(filtersState);

  useEffect(() => {
    getBacktestFiles(symbol).then(setFiles);
  }, [symbol]);

  if (!isClient) {
    return null;
  }

  return (
    <Box
      as="main"
      minH="100vh"
      p={4}
      bg="gray.900"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
      alignItems="flex-start"
    >
      <Flex mb={4} gap={8} flexDirection="row">
        {/* <SelectSymbol /> */}
      </Flex>
      <Box position="relative" flex="1" w="full">
        <List files={files} />
      </Box>
    </Box>
  );
};

export default Dashboard;
