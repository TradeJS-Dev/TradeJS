'use client';

import { Box, ClientOnly, Flex, Heading } from '@chakra-ui/react';
import { Segment, Select } from '#ui';
import { HOURS_OPTIONS, INTERVAL_OPTIONS } from './derivativesDashboardConfig';
import { DerivativesDashboardView } from './DerivativesDashboardView';
import type { DerivativesInterval } from './derivativesViewModel';
import { useDerivativesDashboard } from './useDerivativesDashboard';

const DerivativesPage = () => {
  const {
    hours,
    setHours,
    selectedInterval,
    setSelectedInterval,
    chartWindow,
    dashboard,
  } = useDerivativesDashboard();

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
              <Segment
                defaultValue={selectedInterval}
                value={selectedInterval}
                onChange={(value) =>
                  setSelectedInterval(
                    (value as DerivativesInterval | null) ?? '1h',
                  )
                }
                items={INTERVAL_OPTIONS.map((value) => ({
                  label: value,
                  value,
                }))}
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
