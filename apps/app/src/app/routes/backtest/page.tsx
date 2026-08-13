'use client';

import {
  Badge,
  Box,
  Button,
  ClientOnly,
  Flex,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiFolder, FiRefreshCw } from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import { EmptyState } from '#ui';
import {
  type JobAction,
  useBacktestRunsController,
} from './useBacktestRunsController';
import { BacktestJobItem } from './BacktestJobItem';
import { BacktestRunForm } from './BacktestRunForm';

const BacktestRunPage = () => {
  const router = useRouter();
  const controller = useBacktestRunsController();
  const { state, control, remove, refresh } = controller;
  const { jobs, loadingConfigs, loadingJobs, busyAction } = state;

  const handleAction = (jobId: string, action: JobAction) => {
    void control(jobId, action);
  };

  const handleDeleteJob = (jobId: string) => {
    void remove(jobId);
  };

  const noJobs = !loadingJobs && jobs.length === 0;

  return (
    <ClientOnly>
      <Box minH="100vh" bg="gray.900" color="gray.100">
        <Box
          as="main"
          minH="100vh"
          minW="1200px"
          pl={2}
          pr={4}
          py={3}
          bg="gray.900"
        >
          <Flex alignItems="center" justifyContent="space-between" mb={3}>
            <Box pl={2}>
              <Text fontSize="lg" fontWeight="700" lineHeight="1.2">
                Backtest runs
              </Text>
            </Box>
            <Flex gap={2}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                colorPalette="teal"
                onClick={() => router.push('/routes/strategies/backtest')}
              >
                <FiFolder />
                Results
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void refresh();
                }}
                loading={loadingConfigs || loadingJobs}
              >
                <FiRefreshCw />
                Refresh
              </Button>
            </Flex>
          </Flex>

          <BacktestRunForm controller={controller} />

          <Box maxW="1200px" w="full" mt={5}>
            <Flex alignItems="center" justifyContent="space-between" mb={3}>
              <Flex alignItems="center" gap={3}>
                <Text fontWeight="700">Active runs</Text>
                <Badge colorPalette="gray">{jobs.length} jobs</Badge>
              </Flex>
            </Flex>

            {noJobs ? (
              <EmptyState
                icon={FiFolder}
                title="No backtest jobs"
                description="No queued, running, paused, or finished jobs yet."
              />
            ) : null}

            <Stack gap={3}>
              {jobs.map((job) => (
                <BacktestJobItem
                  key={job.id}
                  job={job}
                  busyAction={busyAction}
                  onAction={handleAction}
                  onDelete={handleDeleteJob}
                  onOpenResults={() =>
                    router.push('/routes/strategies/backtest')
                  }
                />
              ))}
            </Stack>
          </Box>
        </Box>
      </Box>
    </ClientOnly>
  );
};

export default BacktestRunPage;
