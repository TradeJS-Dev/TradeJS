'use client';

import {
  Badge,
  Box,
  Heading,
  ClientOnly,
  Flex,
  Skeleton,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiBookOpen, FiFolder, FiRefreshCw } from 'react-icons/fi';
import Link from 'next/link';
import type { ResearchStudy } from '#app/lib/researchLibraryTypes';
import { studyKey, studyUrl } from '#app/lib/researchStudyLinks';
import { useRouter } from 'next/navigation';
import { PageAction, PageHeader, PageLayout } from '#shared/PageLayout';
import { EmptyState } from '#ui';
import {
  type JobAction,
  useBacktestRunsController,
} from './useBacktestRunsController';
import { BacktestJobItem } from './BacktestJobItem';
import { BacktestRunForm } from './BacktestRunForm';

export function BacktestRunsPage({
  study,
  studyUnavailable,
  openForm,
  researchAvailable,
}: {
  study: ResearchStudy | null;
  studyUnavailable: boolean;
  openForm: boolean;
  researchAvailable: boolean;
}) {
  const router = useRouter();
  const studyRef = study ? studyKey(study) : undefined;
  const controller = useBacktestRunsController(studyRef, study?.strategy);
  const { state, control, remove, refresh } = controller;
  const { jobs: allJobs, loadingConfigs, loadingJobs, busyAction } = state;
  const jobs = studyRef
    ? allJobs.filter((job) => job.request.researchStudy === studyRef)
    : allJobs;

  const handleAction = (jobId: string, action: JobAction) => {
    void control(jobId, action);
  };

  const handleDeleteJob = (jobId: string) => {
    void remove(jobId);
  };

  const showJobsSkeleton = loadingJobs && jobs.length === 0;
  const noJobs = !loadingJobs && jobs.length === 0;

  return (
    <ClientOnly>
      <PageLayout>
        <Stack gap={4}>
          <PageHeader
            title="Backtest runs"
            actions={
              <>
                {researchAvailable && (
                  <PageAction asChild>
                    <Link
                      href={
                        study ? studyUrl(study.strategy, studyRef) : studyUrl()
                      }
                    >
                      <FiBookOpen /> {study ? 'Open research' : 'Research'}
                    </Link>
                  </PageAction>
                )}
                {study && (
                  <PageAction asChild>
                    <Link href="/routes/backtest">All runs</Link>
                  </PageAction>
                )}
                <PageAction
                  type="button"
                  colorPalette="teal"
                  onClick={() => router.push('/routes/strategies/backtest')}
                >
                  <FiFolder />
                  Results
                </PageAction>
                <PageAction
                  type="button"
                  onClick={() => {
                    void refresh();
                  }}
                  disabled={loadingConfigs || loadingJobs}
                >
                  <FiRefreshCw />
                  Refresh
                </PageAction>
              </>
            }
          />

          {study && (
            <Stack gap={1} mb={3} maxW="1200px">
              <Text color="teal.300" fontWeight="semibold">
                {study.title}
              </Text>
              <Text color="gray.400" fontSize="sm">
                New runs started here are linked to this study.
              </Text>
            </Stack>
          )}
          {studyUnavailable ? (
            <Text role="alert" color="orange.300" mb={3}>
              Research study unavailable.{' '}
              <Link href="/routes/backtest">Open all runs</Link>
            </Text>
          ) : (
            <BacktestRunForm controller={controller} initiallyOpen={openForm} />
          )}

          <Box maxW="1200px" w="full" mt={5}>
            <Flex
              alignItems="center"
              justifyContent="space-between"
              wrap="wrap"
              gap={3}
              mb={3}
            >
              <Flex alignItems="center" gap={3}>
                <Heading as="h2" size="md">
                  {study ? 'Linked runs' : 'Active runs'}
                </Heading>
                {showJobsSkeleton ? (
                  <Skeleton h="20px" w="54px" />
                ) : (
                  <Badge colorPalette="gray">{jobs.length} jobs</Badge>
                )}
              </Flex>
            </Flex>

            {showJobsSkeleton && (
              <Stack role="status" aria-label="Loading backtest runs" gap={3}>
                {[0, 1].map((row) => (
                  <Stack
                    key={row}
                    gap={3}
                    bg="gray.800"
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                  >
                    <Skeleton h="22px" w="235px" maxW="full" />
                    <Skeleton h="14px" w="320px" maxW="full" />
                    <Skeleton h="8px" borderRadius="full" />
                  </Stack>
                ))}
              </Stack>
            )}
            {noJobs ? (
              <EmptyState
                icon={FiFolder}
                title={study ? 'No linked runs yet' : 'No backtest jobs'}
                description={
                  study
                    ? 'Start a new backtest from this page to link it to the study.'
                    : 'No queued, running, paused, or finished jobs yet.'
                }
              />
            ) : null}

            <Stack gap={3}>
              {jobs.map((job) => (
                <BacktestJobItem
                  key={job.id}
                  job={job}
                  researchAvailable={researchAvailable}
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
        </Stack>
      </PageLayout>
    </ClientOnly>
  );
}
