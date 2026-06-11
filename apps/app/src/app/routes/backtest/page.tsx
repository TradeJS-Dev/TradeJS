'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  ClientOnly,
  Field,
  Flex,
  Grid,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react';
import {
  FiFolder,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiSquare,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import {
  controlBacktestRun,
  deleteBacktestRun,
  getBacktestRunConfigs,
  getBacktestRuns,
  startBacktestRun,
} from '#actions/backtest';
import { useTickers } from '#store';
import { EmptyState, Segment, Select, SelectWithSearch, toaster } from '#ui';
import type {
  BacktestConfigSummary,
  BacktestJobRecord,
  BacktestJobStatus,
} from '#app/lib/backtestJobs';

const PERIOD_ITEMS = [
  { label: 'Days', value: 'days' },
  { label: 'Date range', value: 'range' },
];
const INTERVAL_ITEMS = [
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
  { label: '4h', value: '240' },
];
const CONNECTOR_ITEMS = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'Binance', value: 'binance' },
  { label: 'Coinbase', value: 'coinbase' },
];

const controlSurface = 'rgba(255, 255, 255, 0.035)';
const controlSurfaceHover = 'rgba(255, 255, 255, 0.05)';

const inputControlProps = {
  bg: controlSurface,
  borderColor: 'gray.700',
  color: 'gray.100',
  _placeholder: { color: 'gray.500' },
  _hover: {
    bg: controlSurfaceHover,
    borderColor: 'gray.600',
  },
  _focusVisible: {
    borderColor: 'gray.500',
    boxShadow: '0 0 0 1px var(--chakra-colors-gray-500)',
  },
};

type PeriodMode = 'days' | 'range';
type JobAction = 'pause' | 'stop' | 'resume' | 'cancel' | 'heartbeat';

const DAY_MS = 24 * 60 * 60 * 1000;

const toInputDate = (date: Date) => date.toISOString().slice(0, 10);

const dateToStartMs = (value: string) =>
  Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    ? Date.parse(`${value}T00:00:00.000Z`)
    : null;

const dateToEndMs = (value: string) =>
  Number.isFinite(Date.parse(`${value}T23:59:59.999Z`))
    ? Date.parse(`${value}T23:59:59.999Z`)
    : null;

const formatNumber = (value: number | null | undefined, fractionDigits = 1) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(fractionDigits)
    : '-';

const formatDateTime = (value: string | undefined) => {
  if (!value) {
    return '-';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '-';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
};

const statusTone = (status: BacktestJobStatus) => {
  if (status === 'running') {
    return 'teal';
  }
  if (status === 'pausing' || status === 'paused') {
    return 'yellow';
  }
  if (status === 'completed') {
    return 'green';
  }
  if (status === 'cancelled') {
    return 'gray';
  }
  return 'red';
};

const statusLabel = (status: BacktestJobStatus) =>
  status.charAt(0).toUpperCase() + status.slice(1);

const getJobTitle = (job: BacktestJobRecord) =>
  `${job.request.strategyName} / ${job.request.configId}`;

const mergeJob = (
  jobs: BacktestJobRecord[],
  updated: BacktestJobRecord,
): BacktestJobRecord[] => {
  const existingIndex = jobs.findIndex((job) => job.id === updated.id);
  if (existingIndex === -1) {
    return [updated, ...jobs];
  }

  const nextJobs = [...jobs];
  nextJobs[existingIndex] = updated;
  return nextJobs;
};

const buildStrategyItems = (configs: BacktestConfigSummary[]) =>
  [...new Set(configs.map((config) => config.strategyName))]
    .sort((left, right) => left.localeCompare(right))
    .map((strategyName) => ({
      label: strategyName,
      value: strategyName,
    }));

const buildConfigItems = (
  configs: BacktestConfigSummary[],
  selectedStrategy: string,
) =>
  configs
    .filter((config) => config.strategyName === selectedStrategy)
    .map((config) => ({
      label: config.id,
      value: config.id,
      description: `${config.combinationCount} combos / ${config.paramCount} params`,
    }));

const SelectControl = ({ children }: { children: React.ReactNode }) => (
  <Box
    w="full"
    minW={0}
    css={{
      '& [data-part="control"]': {
        width: '100%',
      },
      '& [data-part="trigger"], & [data-part="input"]': {
        background: controlSurface,
        borderColor: 'var(--chakra-colors-gray-700)',
        color: 'var(--chakra-colors-gray-100)',
        minWidth: '0',
        width: '100%',
      },
      '& [data-part="trigger"]': {
        flex: '1',
        minHeight: '40px',
      },
      '& [data-part="input"]': {
        flex: '1',
        minHeight: '40px',
      },
      '& [data-part="indicator-group"]': {
        flexShrink: '0',
      },
      '& [data-part="trigger"]:is(:hover, [data-hover]), & [data-part="input"]:is(:hover, [data-hover])':
        {
          background: controlSurfaceHover,
          borderColor: 'var(--chakra-colors-gray-600)',
        },
      '& [data-part="trigger"]:is(:focus-visible, [data-focus-visible]), & [data-part="input"]:is(:focus-visible, [data-focus-visible])':
        {
          borderColor: 'var(--chakra-colors-gray-500)',
          boxShadow: '0 0 0 1px var(--chakra-colors-gray-500)',
        },
      '& [data-part="control"]:is(:hover, [data-hover]) [data-part="input"]': {
        background: controlSurfaceHover,
        borderColor: 'var(--chakra-colors-gray-600)',
      },
    }}
  >
    {children}
  </Box>
);

interface FormSectionProps {
  title: string;
  columns: string;
  children: React.ReactNode;
}

const FormSection = ({ title, columns, children }: FormSectionProps) => (
  <Stack gap={3} minW={0}>
    <Text
      color="gray.400"
      fontSize="xs"
      fontWeight="700"
      letterSpacing="0"
      textTransform="uppercase"
    >
      {title}
    </Text>
    <Grid templateColumns={columns} gap={3} alignItems="end">
      {children}
    </Grid>
  </Stack>
);

const BacktestRunPage = () => {
  const router = useRouter();
  const [configs, setConfigs] = useState<BacktestConfigSummary[]>([]);
  const [jobs, setJobs] = useState<BacktestJobRecord[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState('');
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('days');
  const [days, setDays] = useState('30');
  const [startDate, setStartDate] = useState(() =>
    toInputDate(new Date(Date.now() - 30 * DAY_MS)),
  );
  const [endDate, setEndDate] = useState(() => toInputDate(new Date()));
  const [ai, setAi] = useState(false);
  const [fast, setFast] = useState(false);
  const [interval, setIntervalValue] = useState('15');
  const [connector, setConnector] = useState('bybit');
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [tickersLimit, setTickersLimit] = useState('');
  const [testsLimit, setTestsLimit] = useState('');
  const [parallel, setParallel] = useState('');
  const { tickers: tickerItems, ensureLoaded: ensureTickersLoaded } =
    useTickers(connector, {
      enabled: false,
    });

  const strategyItems = useMemo(() => buildStrategyItems(configs), [configs]);
  const configItems = useMemo(
    () => buildConfigItems(configs, selectedStrategy),
    [configs, selectedStrategy],
  );

  const loadConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    try {
      const nextConfigs = await getBacktestRunConfigs();
      setConfigs(nextConfigs);
    } catch (error) {
      toaster.error({
        title: 'Failed to load backtest configs',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      setLoadingConfigs(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const nextJobs = await getBacktestRuns();
      setJobs(nextJobs);
    } catch (error) {
      toaster.error({
        title: 'Failed to load backtest jobs',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
    void loadJobs();
  }, [loadConfigs, loadJobs]);

  useEffect(() => {
    if (!strategyItems.length) {
      setSelectedStrategy('');
      return;
    }

    if (!strategyItems.some((item) => item.value === selectedStrategy)) {
      setSelectedStrategy(strategyItems[0]?.value || '');
    }
  }, [selectedStrategy, strategyItems]);

  useEffect(() => {
    if (!configItems.length) {
      setSelectedConfigId('');
      return;
    }

    if (!configItems.some((item) => item.value === selectedConfigId)) {
      setSelectedConfigId(configItems[0]?.value || '');
    }
  }, [configItems, selectedConfigId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 3_000);

    return () => window.clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const runningJobs = jobs.filter((job) => job.status === 'running');
      if (!runningJobs.length) {
        return;
      }

      void Promise.all(
        runningJobs.map((job) => controlBacktestRun(job.id, 'heartbeat')),
      )
        .then((updatedJobs) => {
          setJobs((currentJobs) => updatedJobs.reduce(mergeJob, currentJobs));
        })
        .catch(() => {
          // Polling will surface the next durable state.
        });
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [jobs]);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedConfigId),
    [configs, selectedConfigId],
  );

  const handleStart = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedStrategy || !selectedConfigId) {
      toaster.error({
        title: 'Select strategy and config',
        description: 'Backtest config is required before launch.',
      });
      return;
    }

    const payload: Record<string, unknown> = {
      strategyName: selectedStrategy,
      configId: selectedConfigId,
      periodMode,
      ai,
      fast,
      interval,
      connector,
    };

    if (periodMode === 'range') {
      const startTime = dateToStartMs(startDate);
      const endTime = dateToEndMs(endDate);
      if (!startTime || !endTime || startTime >= endTime) {
        toaster.error({
          title: 'Invalid date range',
          description: 'Start date must be earlier than end date.',
        });
        return;
      }
      payload.startTime = startTime;
      payload.endTime = endTime;
    } else {
      const parsedDays = Number(days);
      if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
        toaster.error({
          title: 'Invalid days value',
          description: 'Days must be greater than zero.',
        });
        return;
      }
      payload.days = parsedDays;
    }

    if (selectedTickers.length) {
      payload.tickers = selectedTickers.join(',');
    }

    for (const [field, value] of [
      ['tickersLimit', tickersLimit],
      ['testsLimit', testsLimit],
      ['parallel', parallel],
    ] as const) {
      const parsed = Number(value);
      if (value.trim() && Number.isFinite(parsed) && parsed > 0) {
        payload[field] = Math.trunc(parsed);
      }
    }

    setStarting(true);
    try {
      const job = await startBacktestRun(payload);
      setJobs((currentJobs) => mergeJob(currentJobs, job));
      toaster.success({
        title: 'Backtest started',
        description: getJobTitle(job),
      });
    } catch (error) {
      toaster.error({
        title: 'Backtest start failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      setStarting(false);
    }
  };

  const handleAction = async (jobId: string, action: JobAction) => {
    setBusyAction(`${jobId}:${action}`);
    try {
      const job = await controlBacktestRun(jobId, action);
      setJobs((currentJobs) => mergeJob(currentJobs, job));
    } catch (error) {
      toaster.error({
        title: 'Backtest action failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setBusyAction(`${jobId}:delete`);
    try {
      const deleted = await deleteBacktestRun(jobId);
      if (deleted) {
        setJobs((currentJobs) => currentJobs.filter((job) => job.id !== jobId));
      }
    } catch (error) {
      toaster.error({
        title: 'Backtest job delete failed',
        description: (error as Error)?.message || 'Request failed.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const hasConfigs = configs.length > 0;
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
                  void loadConfigs();
                  void loadJobs();
                }}
                loading={loadingConfigs || loadingJobs}
              >
                <FiRefreshCw />
                Refresh
              </Button>
            </Flex>
          </Flex>

          <Box maxW="1200px" w="full">
            <Box
              borderWidth="1px"
              borderColor="gray.700"
              bg="gray.800"
              p={4}
              borderRadius="md"
            >
              <form onSubmit={handleStart}>
                <Stack gap={5}>
                  <Flex
                    alignItems="center"
                    justifyContent="space-between"
                    gap={4}
                  >
                    <Flex alignItems="center" gap={3} minW={0}>
                      <Text fontWeight="700" flexShrink={0}>
                        New run
                      </Text>
                      {selectedConfig ? (
                        <Flex gap={2} wrap="wrap">
                          <Badge colorPalette="teal">
                            {selectedConfig.combinationCount} combos
                          </Badge>
                          <Badge colorPalette="gray">
                            {selectedConfig.paramCount} params
                          </Badge>
                        </Flex>
                      ) : null}
                    </Flex>
                  </Flex>

                  <FormSection
                    title="Strategy"
                    columns="repeat(2, minmax(0, 1fr))"
                  >
                    <Field.Root>
                      <Field.Label>Strategy</Field.Label>
                      <SelectControl>
                        <Select
                          placeholder="Strategy"
                          value={selectedStrategy ? [selectedStrategy] : []}
                          defaultValue={
                            selectedStrategy ? [selectedStrategy] : []
                          }
                          onChange={(value) =>
                            setSelectedStrategy(value[0] || '')
                          }
                          items={strategyItems}
                          emptyState="No backtest configs"
                          width="100%"
                          disabled={!hasConfigs}
                        />
                      </SelectControl>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Config</Field.Label>
                      <SelectControl>
                        <Select
                          placeholder="Config"
                          value={selectedConfigId ? [selectedConfigId] : []}
                          defaultValue={
                            selectedConfigId ? [selectedConfigId] : []
                          }
                          onChange={(value) =>
                            setSelectedConfigId(value[0] || '')
                          }
                          items={configItems}
                          emptyState="No configs for strategy"
                          width="100%"
                          disabled={!selectedStrategy}
                        />
                      </SelectControl>
                    </Field.Root>
                  </FormSection>

                  <Grid
                    templateColumns="minmax(0, 1fr) 260px"
                    gap={5}
                    alignItems="start"
                  >
                    <FormSection
                      title="Date window"
                      columns={
                        periodMode === 'days'
                          ? '280px minmax(0, 1fr)'
                          : '280px repeat(2, minmax(0, 1fr))'
                      }
                    >
                      <Field.Root>
                        <Field.Label>Mode</Field.Label>
                        <Segment
                          defaultValue="days"
                          value={periodMode}
                          items={PERIOD_ITEMS}
                          onChange={(value) =>
                            setPeriodMode(value === 'range' ? 'range' : 'days')
                          }
                        />
                      </Field.Root>

                      {periodMode === 'days' ? (
                        <Field.Root>
                          <Field.Label>Days</Field.Label>
                          <Input
                            value={days}
                            type="number"
                            min={1}
                            step={1}
                            {...inputControlProps}
                            onChange={(event) => setDays(event.target.value)}
                          />
                        </Field.Root>
                      ) : (
                        <>
                          <Field.Root>
                            <Field.Label>Start</Field.Label>
                            <Input
                              value={startDate}
                              type="date"
                              {...inputControlProps}
                              onChange={(event) =>
                                setStartDate(event.target.value)
                              }
                            />
                          </Field.Root>
                          <Field.Root>
                            <Field.Label>End</Field.Label>
                            <Input
                              value={endDate}
                              type="date"
                              {...inputControlProps}
                              onChange={(event) =>
                                setEndDate(event.target.value)
                              }
                            />
                          </Field.Root>
                        </>
                      )}
                    </FormSection>

                    <FormSection title="Options" columns="1fr">
                      <Flex gap={4} alignItems="center" minH="40px">
                        <Checkbox.Root
                          colorPalette="teal"
                          checked={ai}
                          onCheckedChange={(details) =>
                            setAi(details.checked === true)
                          }
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control
                            bg={controlSurface}
                            borderColor="gray.600"
                          />
                          <Checkbox.Label>AI</Checkbox.Label>
                        </Checkbox.Root>
                        <Checkbox.Root
                          colorPalette="teal"
                          checked={fast}
                          onCheckedChange={(details) =>
                            setFast(details.checked === true)
                          }
                        >
                          <Checkbox.HiddenInput />
                          <Checkbox.Control
                            bg={controlSurface}
                            borderColor="gray.600"
                          />
                          <Checkbox.Label>Fast</Checkbox.Label>
                        </Checkbox.Root>
                      </Flex>
                    </FormSection>
                  </Grid>

                  <FormSection
                    title="Runtime"
                    columns="220px 260px minmax(0, 1fr)"
                  >
                    <Field.Root>
                      <Field.Label>Interval</Field.Label>
                      <SelectControl>
                        <Select
                          placeholder="Interval"
                          value={[interval]}
                          defaultValue={[interval]}
                          onChange={(value) =>
                            setIntervalValue(value[0] || '15')
                          }
                          items={INTERVAL_ITEMS}
                          width="100%"
                        />
                      </SelectControl>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Connector</Field.Label>
                      <SelectControl>
                        <Select
                          placeholder="Connector"
                          value={[connector]}
                          defaultValue={[connector]}
                          onChange={(value) => {
                            setConnector(value[0] || 'bybit');
                            setSelectedTickers([]);
                          }}
                          items={CONNECTOR_ITEMS}
                          width="100%"
                        />
                      </SelectControl>
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Tickers</Field.Label>
                      <Stack gap={2} w="full" minW={0}>
                        <SelectControl>
                          <SelectWithSearch
                            key={connector}
                            multiple
                            placeholder="All tickers"
                            emptyState="No tickers"
                            defaultValue={[]}
                            value={selectedTickers}
                            items={tickerItems}
                            width="100%"
                            onChange={setSelectedTickers}
                            onOpenChange={(open) => {
                              if (open) {
                                void ensureTickersLoaded();
                              }
                            }}
                          />
                        </SelectControl>
                        {selectedTickers.length ? (
                          <Flex gap={2} wrap="wrap">
                            {selectedTickers.map((ticker) => (
                              <Badge
                                key={ticker}
                                colorPalette="teal"
                                display="inline-flex"
                                alignItems="center"
                                gap={1}
                                py="1"
                              >
                                {ticker}
                                <Box
                                  as="span"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`Remove ${ticker}`}
                                  color="gray.300"
                                  cursor="pointer"
                                  _hover={{ color: 'white' }}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === 'Enter' ||
                                      event.key === ' '
                                    ) {
                                      event.preventDefault();
                                      setSelectedTickers((currentTickers) =>
                                        currentTickers.filter(
                                          (currentTicker) =>
                                            currentTicker !== ticker,
                                        ),
                                      );
                                    }
                                  }}
                                  onClick={() =>
                                    setSelectedTickers((currentTickers) =>
                                      currentTickers.filter(
                                        (currentTicker) =>
                                          currentTicker !== ticker,
                                      ),
                                    )
                                  }
                                >
                                  <FiX size={12} />
                                </Box>
                              </Badge>
                            ))}
                          </Flex>
                        ) : null}
                      </Stack>
                    </Field.Root>
                  </FormSection>

                  <FormSection title="Limits" columns="repeat(3, 1fr)">
                    <Field.Root>
                      <Field.Label>Tickers limit</Field.Label>
                      <Input
                        value={tickersLimit}
                        type="number"
                        min={1}
                        {...inputControlProps}
                        onChange={(event) =>
                          setTickersLimit(event.target.value)
                        }
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Tests limit</Field.Label>
                      <Input
                        value={testsLimit}
                        type="number"
                        min={1}
                        {...inputControlProps}
                        onChange={(event) => setTestsLimit(event.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>Parallel</Field.Label>
                      <Input
                        value={parallel}
                        type="number"
                        min={1}
                        {...inputControlProps}
                        onChange={(event) => setParallel(event.target.value)}
                      />
                    </Field.Root>
                  </FormSection>

                  <Flex justifyContent="flex-end" pt={1}>
                    <Button
                      type="submit"
                      colorPalette="teal"
                      disabled={!selectedConfigId || starting}
                      loading={starting}
                      minW="160px"
                    >
                      <FiPlay />
                      Start
                    </Button>
                  </Flex>
                </Stack>
              </form>
            </Box>
          </Box>

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

interface BacktestJobItemProps {
  job: BacktestJobRecord;
  busyAction: string;
  onAction: (jobId: string, action: JobAction) => void;
  onDelete: (jobId: string) => void;
  onOpenResults: () => void;
}

const BacktestJobItem = ({
  job,
  busyAction,
  onAction,
  onDelete,
  onOpenResults,
}: BacktestJobItemProps) => {
  const progress = job.progress;
  const totalLabel = progress.total == null ? '?' : progress.total;
  const logs = job.logs.slice(-10);
  const canPause = job.status === 'running';
  const canResume = job.status === 'paused';
  const canCancel = !['completed', 'cancelled'].includes(job.status);
  const canDelete = ['completed', 'cancelled', 'failed', 'paused'].includes(
    job.status,
  );

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.700"
      bg="gray.800"
      p={4}
      borderRadius="md"
    >
      <Flex alignItems="flex-start" justifyContent="space-between" gap={4}>
        <Box minW={0}>
          <Flex gap={2} alignItems="center" wrap="wrap">
            <Text fontWeight="700" wordBreak="break-word">
              {getJobTitle(job)}
            </Text>
            <Badge colorPalette={statusTone(job.status)}>
              {statusLabel(job.status)}
            </Badge>
            {job.request.ai ? <Badge colorPalette="purple">AI</Badge> : null}
            {job.request.fast ? <Badge colorPalette="blue">Fast</Badge> : null}
          </Flex>
          <Text fontSize="xs" color="gray.400" mt={1}>
            Started {formatDateTime(job.startedAt)} · Updated{' '}
            {formatDateTime(job.updatedAt)} · Run #{job.runCount}
          </Text>
          {job.pauseReason ? (
            <Text fontSize="xs" color="yellow.300" mt={1}>
              Pause reason: {job.pauseReason}
            </Text>
          ) : null}
          {job.error ? (
            <Text fontSize="xs" color="red.300" mt={1}>
              {job.error}
            </Text>
          ) : null}
        </Box>

        <Flex gap={2} flexShrink={0} wrap="wrap" justifyContent="flex-end">
          {canPause ? (
            <>
              <Button
                type="button"
                size="xs"
                variant="outline"
                loading={busyAction === `${job.id}:pause`}
                onClick={() => onAction(job.id, 'pause')}
              >
                <FiPause />
                Pause
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                loading={busyAction === `${job.id}:stop`}
                onClick={() => onAction(job.id, 'stop')}
              >
                <FiSquare />
                Stop
              </Button>
            </>
          ) : null}

          {canResume ? (
            <Button
              type="button"
              size="xs"
              colorPalette="teal"
              loading={busyAction === `${job.id}:resume`}
              onClick={() => onAction(job.id, 'resume')}
            >
              <FiPlay />
              Resume
            </Button>
          ) : null}

          {job.status === 'completed' ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              colorPalette="teal"
              onClick={onOpenResults}
            >
              <FiFolder />
              Results
            </Button>
          ) : null}

          {canCancel ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              colorPalette="red"
              loading={busyAction === `${job.id}:cancel`}
              onClick={() => onAction(job.id, 'cancel')}
            >
              <FiX />
              Cancel
            </Button>
          ) : null}

          {canDelete ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              colorPalette="red"
              loading={busyAction === `${job.id}:delete`}
              onClick={() => onDelete(job.id)}
            >
              <FiTrash2 />
            </Button>
          ) : null}
        </Flex>
      </Flex>

      <Box mt={4}>
        <Flex alignItems="center" justifyContent="space-between" mb={2}>
          <Text fontSize="sm" color="gray.300">
            {progress.completed}/{totalLabel} tests
          </Text>
          <Text fontSize="sm" color="gray.300">
            {formatNumber(progress.percent, 1)}%
          </Text>
        </Flex>
        <Box h="8px" bg="gray.800" borderRadius="full" overflow="hidden">
          <Box
            h="full"
            bg={job.status === 'failed' ? 'red.500' : 'teal.400'}
            width={`${Math.max(0, Math.min(100, progress.percent))}%`}
            transition="width 0.2s ease"
          />
        </Box>
      </Box>

      <Grid templateColumns="repeat(5, minmax(0, 1fr))" gap={3} mt={4}>
        <Metric
          label="Avg P&L"
          value={`${formatNumber(progress.averageProfit, 2)}$`}
        />
        <Metric
          label="Winrate"
          value={`${formatNumber(progress.winRate, 1)}%`}
        />
        <Metric label="Success" value={String(progress.successTests ?? '-')} />
        <Metric label="Errors" value={String(progress.errorTests ?? '-')} />
        <Metric label="PID" value={String(job.pid ?? '-')} />
      </Grid>

      {logs.length ? (
        <Box mt={4} bg="gray.950" borderRadius="md" p={3} overflow="hidden">
          <Stack gap={1}>
            {logs.map((line, index) => (
              <Text
                key={`${job.id}:log:${index}`}
                fontFamily="mono"
                fontSize="xs"
                color="gray.300"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {line}
              </Text>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <Box minW={0}>
    <Text fontSize="xs" color="gray.500">
      {label}
    </Text>
    <Text
      fontSize="sm"
      color="gray.100"
      fontWeight="700"
      overflow="hidden"
      textOverflow="ellipsis"
      whiteSpace="nowrap"
    >
      {value}
    </Text>
  </Box>
);

export default BacktestRunPage;
