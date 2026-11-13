'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Skeleton,
  Stack,
  Text,
} from '@chakra-ui/react';
import { Select } from '#ui';
import type {
  DataBackfillJob,
  DataBackfillRequest,
  DataCoverageDataset,
} from '@tradejs/types';

const endpoint = '/api/data-coverage/queue';
const utc = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const statuses: Record<DataBackfillJob['status'], string> = {
  queued: 'Queued',
  running: 'Loading',
  completed: 'Complete',
  partial: 'Gaps remain',
  failed: 'Failed',
};

export async function queueDataBackfill({
  dataset,
  series,
  day,
}: DataBackfillRequest): Promise<DataBackfillJob> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset, series, day }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || 'Could not queue this backfill.');
  return result;
}

export function QueueGapButton({ dataset, series, day }: DataBackfillRequest) {
  const [state, setState] = useState<'pending' | 'queued' | 'error'>();
  return (
    <Flex gap={2} align="center" wrap="wrap">
      <Button
        size="xs"
        variant="outline"
        disabled={state === 'pending' || state === 'queued'}
        onClick={async () => {
          setState('pending');
          try {
            await queueDataBackfill({ dataset, series, day });
            setState('queued');
          } catch {
            setState('error');
          }
        }}
      >
        {state === 'pending'
          ? 'Adding…'
          : state === 'queued'
            ? 'Added to queue'
            : 'Queue backfill'}
      </Button>
      {state === 'error' && (
        <Text role="alert" color="red.300" fontSize="xs">
          Could not queue this gap.
        </Text>
      )}
    </Flex>
  );
}

export function DataBackfillQueue({
  datasets,
}: {
  datasets: DataCoverageDataset[];
}) {
  const [jobs, setJobs] = useState<DataBackfillJob[]>();
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? '');
  const [series, setSeries] = useState('');
  const [date, setDate] = useState('');
  const [revision, setRevision] = useState(0);
  const selected = datasets.find((dataset) => dataset.id === datasetId);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let delay = 10_000;
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load the queue.');
        const next: DataBackfillJob[] = await response.json();
        if (!controller.signal.aborted) {
          setJobs(next);
          setLoadError(false);
          if (
            next.some(
              (job) => job.status === 'running' || job.status === 'queued',
            )
          )
            delay = 2000;
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void refresh();
          }, delay);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);

  async function submit(request: DataBackfillRequest) {
    setPending(true);
    setError('');
    try {
      const job = await queueDataBackfill(request);
      setJobs((current) => [
        job,
        ...(current ?? []).filter((item) => item.id !== job.id),
      ]);
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not queue this backfill.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack gap={4}>
      <Box as="details" borderWidth="1px" borderColor="gray.700" p={3}>
        <Box as="summary" cursor="pointer" fontWeight="medium">
          Queue a day manually
        </Box>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected) return;
            void submit({
              dataset: datasetId,
              series: selected.dimension ? series.trim() : 'Total',
              day: Date.parse(date),
            });
          }}
        >
          <Grid
            alignItems="end"
            gap={3}
            mt={3}
            templateColumns={{ base: '1fr', md: '2fr 1fr 1fr auto' }}
          >
            <Stack as="label" gap={1}>
              <Text fontSize="sm">Dataset</Text>
              <Select
                aria-label="Dataset"
                width="100%"
                defaultValue={[]}
                value={[datasetId]}
                items={datasets.map(({ id, provider, label, interval }) => ({
                  value: id,
                  label: `${provider} · ${label} · ${interval}`,
                }))}
                onChange={([id]) => {
                  setDatasetId(id ?? '');
                  setSeries('');
                }}
              />
            </Stack>
            {selected?.dimension && (
              <Stack as="label" gap={1}>
                <Text fontSize="sm">
                  {selected.dimension === 'symbol'
                    ? 'Instrument'
                    : selected.dimension === 'universe'
                      ? 'Basket'
                      : 'Index'}
                </Text>
                <Input
                  size="sm"
                  required
                  value={series}
                  onChange={(event) => setSeries(event.target.value)}
                  placeholder={
                    selected.dimension === 'symbol' ? 'BTCUSDT' : undefined
                  }
                />
              </Stack>
            )}
            <Stack as="label" gap={1}>
              <Text fontSize="sm">Day (UTC)</Text>
              <Input
                type="date"
                size="sm"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Stack>
            <Button
              type="submit"
              size="sm"
              colorPalette="teal"
              loading={pending}
            >
              Queue backfill
            </Button>
          </Grid>
        </form>
      </Box>
      <Heading as="h2" size="sm">
        Backfill jobs
      </Heading>
      {error && (
        <Text role="alert" color="red.300">
          {error}
        </Text>
      )}
      {loadError && (
        <Text role="alert" color="red.300">
          Could not refresh the queue.
        </Text>
      )}
      {!jobs && !loadError && (
        <Skeleton h="90px" aria-label="Loading backfill jobs" />
      )}
      {jobs?.length === 0 && (
        <Text color="gray.400">
          No jobs yet. Open a day in Coverage to queue a gap.
        </Text>
      )}
      {jobs?.map((job) => {
        const dataset = datasets.find(({ id }) => id === job.dataset);
        const retryable = job.status === 'failed' || job.status === 'partial';
        return (
          <Stack
            key={job.id}
            gap={1}
            p={3}
            borderWidth="1px"
            borderColor="gray.700"
            borderRadius="md"
          >
            <Flex align="center" justify="space-between" gap={2} wrap="wrap">
              <Text fontWeight="medium">
                {dataset
                  ? `${dataset.provider} · ${dataset.label} · ${dataset.interval}`
                  : job.dataset}
              </Text>
              <Text
                fontSize="sm"
                color={
                  job.status === 'completed'
                    ? 'teal.300'
                    : retryable
                      ? 'orange.300'
                      : 'gray.300'
                }
              >
                {statuses[job.status]}
              </Text>
            </Flex>
            <Text fontSize="sm" color="gray.400">
              {job.series} · {utc.format(job.day)} UTC
            </Text>
            {job.result && (
              <Text fontSize="sm">
                {job.result.added} added · {job.result.loaded} loaded ·{' '}
                {job.result.missing} missing
              </Text>
            )}
            {job.error && (
              <Text fontSize="sm" color="red.300">
                {job.error}
              </Text>
            )}
            {retryable && (
              <Button
                size="xs"
                variant="outline"
                alignSelf="start"
                disabled={pending}
                onClick={() => {
                  void submit(job);
                }}
              >
                Retry
              </Button>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}
