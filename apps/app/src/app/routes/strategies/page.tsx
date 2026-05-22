'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, ClientOnly, Flex, Text } from '@chakra-ui/react';
import { FiFolder } from 'react-icons/fi';
import type { StrategyChartsSnapshotResponse } from '@tradejs/types';
import {
  getAiStrategies,
  getReplayStrategies,
  getRuntimeStrategies,
} from '#actions/strategies';
import { RuntimeStrategyCard } from '#components/Strategies/RuntimeStrategyCard';
import { RuntimeStrategyCardSkeleton } from '#components/Strategies/RuntimeStrategyCardSkeleton';
import { StrategySnapshotCard } from '#components/Strategies/StrategySnapshotCard';
import type { RuntimeStrategiesResponse } from '#app/lib/runtimeStrategies';
import { EmptyState, Segment, Select } from '#ui';

const ALL_STRATEGIES = '__all__';
const MODE_ITEMS = [
  { label: 'Runtime', value: 'runtime' },
  { label: 'Replay', value: 'replay' },
  { label: 'AI', value: 'ai' },
];
const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 90d', value: '2160' },
];

const RuntimeStrategiesPage = () => {
  const [mode, setMode] = useState<'runtime' | 'replay' | 'ai'>('runtime');
  const [hours, setHours] = useState('168');
  const [selectedStrategy, setSelectedStrategy] = useState(ALL_STRATEGIES);
  const [loading, setLoading] = useState(false);
  const [fulfilled, setFulfilled] = useState(false);
  const [error, setError] = useState('');
  const [runtimeData, setRuntimeData] =
    useState<RuntimeStrategiesResponse | null>(null);
  const [snapshotData, setSnapshotData] =
    useState<StrategyChartsSnapshotResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      if (mode === 'runtime') {
        const response = await getRuntimeStrategies({ hours: Number(hours) });
        setRuntimeData(response);
        setSnapshotData(null);
      } else if (mode === 'replay') {
        const response = await getReplayStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      } else {
        const response = await getAiStrategies();
        setSnapshotData(response);
        setRuntimeData(null);
      }
      setFulfilled(true);
    } catch (err) {
      setError(
        (err as Error)?.message ||
          `Failed to load ${mode === 'runtime' ? 'runtime strategies' : `${mode} strategy charts`}`,
      );
      setFulfilled(true);
    } finally {
      setLoading(false);
    }
  }, [hours, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const strategyItems = useMemo(() => {
    const names = [
      ...new Set(
        mode === 'runtime'
          ? runtimeData?.strategies.map((strategy) => strategy.strategyName) ??
            []
          : snapshotData?.strategies.map((strategy) => strategy.strategyName) ??
            [],
      ),
    ].sort((left, right) => left.localeCompare(right));

    return [
      { label: 'All strategies', value: ALL_STRATEGIES },
      ...names.map((name) => ({ label: name, value: name })),
    ];
  }, [mode, runtimeData?.strategies, snapshotData?.strategies]);

  useEffect(() => {
    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      setSelectedStrategy(ALL_STRATEGIES);
    }
  }, [selectedStrategy, strategyItems]);

  const filteredRuntimeStrategies = useMemo(() => {
    const strategies = runtimeData?.strategies ?? [];

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [runtimeData?.strategies, selectedStrategy]);

  const filteredSnapshotStrategies = useMemo(() => {
    const strategies = snapshotData?.strategies ?? [];

    if (selectedStrategy === ALL_STRATEGIES) {
      return strategies;
    }

    return strategies.filter(
      (strategy) => strategy.strategyName === selectedStrategy,
    );
  }, [snapshotData?.strategies, selectedStrategy]);

  const handleSnapshotDeleted = useCallback((cardId: string) => {
    setSnapshotData((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        strategies: prev.strategies.filter(
          (strategy) => strategy.cardId !== cardId,
        ),
      };
    });
  }, []);

  const noData =
    fulfilled &&
    !loading &&
    !error &&
    (mode === 'runtime'
      ? filteredRuntimeStrategies.length === 0
      : filteredSnapshotStrategies.length === 0);

  const emptyTitle =
    mode === 'runtime'
      ? 'No runtime strategies found'
      : mode === 'replay'
        ? 'No replay charts found'
        : 'No AI charts found';

  const emptyDescription =
    mode === 'runtime'
      ? 'No connected strategies or runtime trades were found for the selected window.'
      : mode === 'replay'
        ? 'Run `yarn replay --chart` to save replay strategy cards for this page.'
        : 'Run `yarn ai-train --chart` to save strategy-wide AI cards for this page.';

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
              <Segment
                defaultValue="runtime"
                value={mode}
                onChange={(value) =>
                  setMode((value as 'runtime' | 'replay' | 'ai') || 'runtime')
                }
                items={MODE_ITEMS}
              />
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
              {mode === 'runtime' ? (
                <Select
                  placeholder="Window"
                  value={[hours]}
                  defaultValue={[hours]}
                  onChange={(value) => setHours(value[0] || '168')}
                  items={HOURS_OPTIONS}
                  width="180px"
                />
              ) : null}
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
                title={emptyTitle}
                description={emptyDescription}
              />
            ) : null}

            {!loading &&
              mode === 'runtime' &&
              filteredRuntimeStrategies.map((strategy) => (
                <RuntimeStrategyCard
                  key={strategy.strategyName}
                  strategy={strategy}
                  provider={runtimeData?.provider || 'bybit'}
                />
              ))}

            {!loading &&
              mode !== 'runtime' &&
              filteredSnapshotStrategies.map((strategy) => (
                <StrategySnapshotCard
                  key={strategy.cardId}
                  snapshot={strategy}
                  mode={mode}
                  onDeleted={handleSnapshotDeleted}
                  emptyText={
                    mode === 'replay'
                      ? 'No replay trades for the selected run.'
                      : 'No approved trades for this quality bucket.'
                  }
                />
              ))}
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default RuntimeStrategiesPage;
