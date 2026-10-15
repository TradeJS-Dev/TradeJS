'use client';

import { Box, ClientOnly, Flex, Heading } from '@chakra-ui/react';
import { Select } from '#ui';
import { HOURS_OPTIONS } from './derivativesDashboardConfig';
import { DerivativesDashboardView } from './DerivativesDashboardView';
import { useDerivativesDashboard } from './useDerivativesDashboard';

const DerivativesPage = () => {
  const { hours, setHours, chartWindow, dashboard } = useDerivativesDashboard();

  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.950">
        <Box as="main" maxW="1600px" mx="auto" px={6} py={6}>
          <Flex
            mb={6}
            gap={4}
            alignItems={{ base: 'flex-start', lg: 'center' }}
            justifyContent="space-between"
            wrap="wrap"
          >
            <Heading size="lg">Derivatives Dashboard</Heading>
            <Flex gap={3} wrap="wrap" alignItems="center">
              <Select
                placeholder="Window"
                defaultValue={[hours]}
                value={[hours]}
                onChange={(value) => setHours(value[0] || '24')}
                items={HOURS_OPTIONS}
                width="180px"
              />
            </Flex>
          </Flex>
          <DerivativesDashboardView
            dashboard={dashboard}
            chartWindow={chartWindow}
          />
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default DerivativesPage;
