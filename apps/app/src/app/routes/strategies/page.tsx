'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, ClientOnly, Flex, Text } from '@chakra-ui/react';
import { FiFolder } from 'react-icons/fi';
import { getRuntimeStrategies } from '#actions/strategies';
import { RuntimeStrategyCard } from '#components/Strategies/RuntimeStrategyCard';
import { RuntimeStrategyCardSkeleton } from '#components/Strategies/RuntimeStrategyCardSkeleton';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';
import { EmptyState, Select } from '#ui';

const ALL_STRATEGIES = '__all__';
const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 90d', value: '2160' },
];

const RuntimeStrategiesPage = () => {
  const [hours, setHours] = useState('168');
  const [selectedStrategy, setSelectedStrategy] = useState(ALL_STRATEGIES);
  const [loading, setLoading] = useState(false);
  const [fulfilled, setFulfilled] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<RuntimeStrategiesResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await getRuntimeStrategies({ hours: Number(hours) });
      setData(response);
      setFulfilled(true);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load runtime strategies');
      setFulfilled(true);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  const strategyItems = useMemo(() => {
    const names =
      data?.strategies.map((strategy) => strategy.strategyName) ?? [];

    return [
      { label: 'All strategies', value: ALL_STRATEGIES },
      ...names.map((name) => ({ label: name, value: name })),
    ];
  }, [data?.strategies]);

  useEffect(() => {
    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      setSelectedStrategy(ALL_STRATEGIES);
    }
  }, [selectedStrategy, strategyItems]);

  const filteredStrategies = useMemo(() => {
    const strategies = data?.strategies ?? [];

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [data?.strategies, selectedStrategy]);

  const noData =
    fulfilled && !loading && !error && filteredStrategies.length === 0;

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
          alignItems="flex-start"
        >
          <Flex
            mb={2}
            mt={2}
            pl={2}
            gap={8}
            flexDirection="row"
            alignItems="center"
          >
            <Flex gap={3} alignItems="center">
              <Select
                placeholder="Strategy"
                value={[selectedStrategy]}
                defaultValue={[selectedStrategy]}
                onChange={(value) =>
                  setSelectedStrategy(value[0] || ALL_STRATEGIES)
                }
                items={strategyItems}
                width="220px"
              />
              <Select
                placeholder="Window"
                value={[hours]}
                defaultValue={[hours]}
                onChange={(value) => setHours(value[0] || '168')}
                items={HOURS_OPTIONS}
                width="180px"
              />
            </Flex>
          </Flex>

          {error ? (
            <Box
              ml={2}
              mb={4}
              p={4}
              borderRadius="md"
              borderWidth="1px"
              borderColor="red.900"
              bg="red.950"
            >
              <Text color="red.200">{error}</Text>
            </Box>
          ) : null}

          <Box flex="1" h="full" w="full">
            {loading ? (
              <>
                <RuntimeStrategyCardSkeleton />
                <RuntimeStrategyCardSkeleton />
              </>
            ) : null}

            {noData ? (
              <EmptyState
                icon={FiFolder}
                title="No runtime strategies found"
                description="No connected strategies or runtime trades were found for the selected window."
              />
            ) : null}

            {!loading &&
              filteredStrategies.map((strategy) => (
                <RuntimeStrategyCard
                  key={strategy.strategyName}
                  strategy={strategy}
                  provider={data?.provider || 'bybit'}
                />
              ))}
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default RuntimeStrategiesPage;
