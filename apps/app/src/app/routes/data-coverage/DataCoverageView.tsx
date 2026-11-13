'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Skeleton,
  Stack,
  Tabs,
  Text,
  chakra,
} from '@chakra-ui/react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import type {
  DataCoverage,
  DataCoverageDataset,
  DataCoverageSeriesDay,
} from '@tradejs/types';

import { DataBackfillQueue, QueueGapButton } from './DataBackfillQueue';

const DAY_MS = 86_400_000;
const shortMonth = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  timeZone: 'UTC',
});
const fullMonth = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const fullDate = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const number = new Intl.NumberFormat('en-GB');

const colors = {
  complete: 'teal.500',
  partial: 'teal.800',
  gaps: 'orange.400',
  missing: 'red.500',
  outside: 'gray.700',
};

const legend = [
  [colors.complete, 'Complete'],
  [colors.partial, 'Some series outside range'],
  [colors.gaps, 'Gaps'],
  [colors.missing, 'All expected samples missing'],
  [colors.outside, 'Outside range'],
];

type CoverageResult = { coverage: DataCoverage } | { error: true };

type ScanProgress = {
  scannedDays: number;
  totalDays: number;
  coverage?: DataCoverage;
};
const cacheKey = (dataset: string, year: number) =>
  `tradejs:coverage:v1:${year}:${dataset}`;
const cacheLifetime = DAY_MS;

function readPreviousCoverage(
  dataset: string,
  year: number,
): DataCoverage | undefined {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(cacheKey(dataset, year)) ?? 'null',
    );
    if (saved && Date.now() - saved.savedAt < cacheLifetime)
      return saved.coverage;
  } catch {
    // The page remains usable when browser storage is unavailable.
  }
}

async function loadCoverageOverview(
  dataset: string,
  year: number,
  signal: AbortSignal,
  refresh: boolean,
  onProgress: (progress: ScanProgress) => void,
): Promise<DataCoverage> {
  const params = new URLSearchParams({
    dataset,
    year: String(year),
    progress: '1',
  });
  if (refresh) params.set('refresh', '1');
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(135_000)]);
  for (;;) {
    const response = await fetch(`/api/data-coverage?${params}`, {
      signal: requestSignal,
    });
    if (response.status === 202) {
      onProgress(await response.json());
      params.delete('refresh');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      requestSignal.throwIfAborted();
      continue;
    }
    if (!response.ok) throw new Error('Could not load data coverage.');
    return response.json();
  }
}

async function loadCoverage<T>(
  dataset: string,
  year: number,
  signal: AbortSignal,
  options: { day?: number; refresh?: boolean } = {},
): Promise<T> {
  const params = new URLSearchParams({ dataset, year: String(year) });
  if (options.day !== undefined) params.set('day', String(options.day));
  if (options.refresh) params.set('refresh', '1');
  const response = await fetch(`/api/data-coverage?${params}`, { signal });
  if (!response.ok) throw new Error('Could not load data coverage.');
  return response.json();
}

function DayDetails({
  dataset,
  year,
  day,
  onClose,
}: {
  dataset: DataCoverageDataset;
  year: number;
  day: number;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<DataCoverageSeriesDay[] | 'error'>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadCoverage<DataCoverageSeriesDay[]>(
      dataset.id,
      year,
      controller.signal,
      { day },
    )
      .then((result) => {
        if (!controller.signal.aborted) setDetails(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetails('error');
      });
    return () => controller.abort();
  }, [dataset.id, day, year]);

  const gaps = Array.isArray(details)
    ? details.filter(({ missing }) => missing > 0)
    : [];
  const visible =
    Array.isArray(details) && (showAll || gaps.length === 0) ? details : gaps;
  return (
    <Stack gap={2} borderTopWidth="1px" borderColor="gray.700" px={3} py={3}>
      <Flex align="center" justify="space-between" gap={2}>
        <Text fontWeight="semibold">{fullDate.format(day)} UTC</Text>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Close details
        </Button>
      </Flex>
      {details === undefined && (
        <Stack role="status" aria-label="Loading series" gap={2}>
          <Skeleton h="20px" w="170px" />
          <Grid
            templateColumns="repeat(auto-fit, minmax(min(230px, 100%), 1fr))"
            gap={2}
          >
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} h="48px" />
            ))}
          </Grid>
        </Stack>
      )}
      {details === 'error' && (
        <Text role="alert" color="red.300">
          Could not load series.
        </Text>
      )}
      {Array.isArray(details) && (
        <>
          <Text color="gray.400" fontSize="sm">
            {number.format(details.length)} series ·{' '}
            {number.format(gaps.length)} with gaps
          </Text>
          {gaps.length > 0 && gaps.length < details.length && (
            <Button
              size="xs"
              alignSelf="start"
              variant="outline"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show gaps only' : 'Show all series'}
            </Button>
          )}
          <Grid
            as="ul"
            m={0}
            listStyleType="none"
            templateColumns="repeat(auto-fit, minmax(min(230px, 100%), 1fr))"
            gap={2}
            maxH="240px"
            overflowY="auto"
          >
            {visible.map(({ key, loaded, missing }) => (
              <Box
                as="li"
                key={key}
                bg="gray.900"
                borderRadius="sm"
                px={2}
                py={1}
                fontSize="sm"
              >
                <Text fontWeight="medium" overflowWrap="anywhere">
                  {key}
                </Text>
                <Text color={missing ? 'orange.300' : 'gray.400'}>
                  {number.format(loaded)} loaded · {number.format(missing)}{' '}
                  missing
                </Text>
                {missing > 0 && (
                  <QueueGapButton dataset={dataset.id} series={key} day={day} />
                )}
              </Box>
            ))}
          </Grid>
        </>
      )}
    </Stack>
  );
}

type CoverageBlock = { from: number; to: number; label: string };

function CoverageRow({
  dataset,
  year,
  blocks,
  monthView,
  result,
  progress,
  updateFailed,
  selection,
  onSelect,
}: {
  dataset: DataCoverageDataset;
  year: number;
  blocks: CoverageBlock[];
  monthView: boolean;
  result?: CoverageResult;
  progress?: ScanProgress;
  updateFailed?: boolean;
  selection?: number;
  onSelect: (day: number) => void;
}) {
  const [focusedBlock, setFocusedBlock] = useState(0);
  const coverage = result && 'coverage' in result ? result.coverage : undefined;
  const byDay = new Map(coverage?.days.map((day) => [day.day, day]));
  const missing =
    coverage?.days.reduce((sum, day) => sum + day.missing, 0) ?? 0;
  const detailId = `coverage-day-${dataset.id}`;

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const target = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: blocks.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(blocks.length - 1, target));
    event.currentTarget.parentElement
      ?.querySelectorAll('button')
      [next]?.focus();
  };

  return (
    <Box borderTopWidth="1px" borderColor="gray.700" aria-busy={!result}>
      <Grid
        templateColumns={{ base: '1fr', md: '235px minmax(0, 1fr)' }}
        alignItems="center"
        columnGap={4}
        rowGap={1}
        px={3}
        py={2}
      >
        <Box>
          <Text fontWeight="medium" fontSize="sm">
            {dataset.label} · {dataset.interval}
          </Text>
          {result && (
            <Text color={missing ? 'orange.300' : 'gray.400'} fontSize="xs">
              {'error' in result
                ? 'Could not load coverage'
                : `${number.format(result.coverage.series)} series · ${number.format(missing)} missing${monthView ? ' this year' : ''}`}
            </Text>
          )}
          {progress && (
            <Text color="gray.400" fontSize="xs">
              {progress.scannedDays > 0
                ? `${progress.scannedDays} of ${progress.totalDays} days scanned`
                : result
                  ? 'Waiting to refresh'
                  : 'Waiting to scan'}
            </Text>
          )}
          {updateFailed && (
            <Text color="orange.300" fontSize="xs">
              Update failed. Showing last result.
            </Text>
          )}
          {coverage?.first != null && coverage.last != null && (
            <Text color="gray.400" fontSize="xs">
              {date.formatRange(coverage.first, coverage.last)}
            </Text>
          )}
        </Box>
        <Grid
          templateColumns={`repeat(${blocks.length}, minmax(0, 1fr))`}
          gap={{ base: '2px', md: '3px' }}
          aria-label={`${dataset.provider} ${dataset.label} ${dataset.interval}`}
        >
          {blocks.map(({ from, to, label }, index) => {
            if (!result)
              return <Skeleton key={from} h="24px" borderRadius="sm" />;
            let loaded = 0;
            let missingInBlock = 0;
            let activeSeriesDays = 0;
            for (let day = from; day < to; day += DAY_MS) {
              const counts = byDay.get(day);
              loaded += counts?.loaded ?? 0;
              missingInBlock += counts?.missing ?? 0;
              activeSeriesDays += counts?.series ?? 0;
            }
            const title = `${dataset.provider} ${dataset.label} ${dataset.interval}, ${label} UTC · ${activeSeriesDays ? `${number.format(loaded)} loaded · ${number.format(missingInBlock)} missing` : 'Outside loaded range'}`;
            const color = !activeSeriesDays
              ? colors.outside
              : missingInBlock
                ? loaded
                  ? colors.gaps
                  : colors.missing
                : activeSeriesDays <
                    (coverage?.series ?? 0) * ((to - from) / DAY_MS)
                  ? colors.partial
                  : colors.complete;
            return coverage ? (
              <chakra.button
                type="button"
                key={from}
                h="24px"
                minW={0}
                borderRadius="sm"
                bg={color}
                title={title}
                aria-label={title}
                aria-expanded={monthView ? selection === from : undefined}
                aria-controls={selection === from ? detailId : undefined}
                tabIndex={focusedBlock === index ? 0 : -1}
                onFocus={() => setFocusedBlock(index)}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={() => onSelect(from)}
                outline={selection === from ? '2px solid white' : undefined}
                _hover={{ opacity: 0.75 }}
                _focusVisible={{
                  outline: '2px solid white',
                  outlineOffset: '1px',
                }}
              />
            ) : (
              <Box key={from} h="24px" borderRadius="sm" bg={color} />
            );
          })}
        </Grid>
      </Grid>
      {selection !== undefined && (
        <Box id={detailId}>
          <DayDetails
            key={selection}
            dataset={dataset}
            year={year}
            day={selection}
            onClose={() => onSelect(selection)}
          />
        </Box>
      )}
    </Box>
  );
}

function CoverageOverview({
  datasets,
  year,
  to,
  refresh,
  revision,
}: {
  datasets: DataCoverageDataset[];
  year: number;
  to: number;
  refresh: boolean;
  revision: number;
}) {
  const [results, setResults] = useState<Record<string, CoverageResult>>({});
  const [scans, setScans] = useState<
    Record<string, ScanProgress | 'failed' | 'ready'>
  >({});
  const [month, setMonth] = useState<number>();
  const [selection, setSelection] = useState<{ id: string; day: number }>();
  const months = Array.from({ length: 12 }, (_, index) => ({
    from: Date.UTC(year, index, 1),
    to: Math.min(Date.UTC(year, index + 1, 1), to),
    label: fullMonth.format(Date.UTC(year, index, 1)),
  })).filter((block) => block.from < block.to);
  const monthBlock = months.find((block) => block.from === month);
  const blocks = monthBlock
    ? Array.from(
        { length: (monthBlock.to - monthBlock.from) / DAY_MS },
        (_, index) => {
          const from = monthBlock.from + index * DAY_MS;
          return { from, to: from + DAY_MS, label: fullDate.format(from) };
        },
      )
    : months;
  const visible = datasets.filter(({ id }) => {
    const result = results[id];
    return !result || 'error' in result || result.coverage.series > 0;
  });
  const providers = Map.groupBy(visible, ({ provider }) => provider);

  useEffect(() => {
    const controller = new AbortController();
    setScans(
      Object.fromEntries(
        datasets.map(({ id }) => [id, { scannedDays: 0, totalDays: 0 }]),
      ),
    );
    const saved = datasets.flatMap(({ id }) => {
      const coverage = readPreviousCoverage(id, year);
      return coverage ? [[id, { coverage }] as const] : [];
    });
    setResults((current) => ({ ...Object.fromEntries(saved), ...current }));

    const loadRows = async (rows: DataCoverageDataset[]) => {
      for (const dataset of rows) {
        if (controller.signal.aborted) return;
        const { id } = dataset;
        try {
          const coverage = await loadCoverageOverview(
            id,
            year,
            controller.signal,
            refresh,
            (progress) => {
              if (controller.signal.aborted) return;
              setScans((current) => ({ ...current, [id]: progress }));
              if (progress.coverage) {
                const coverage = progress.coverage;
                setResults((current) => ({ ...current, [id]: { coverage } }));
              }
            },
          );
          if (controller.signal.aborted) return;
          setResults((current) => ({ ...current, [id]: { coverage } }));
          setScans((current) => ({ ...current, [id]: 'ready' }));
          try {
            sessionStorage.setItem(
              cacheKey(id, year),
              JSON.stringify({ coverage, savedAt: Date.now() }),
            );
          } catch {
            // A storage quota cannot prevent rendering a completed scan.
          }
        } catch {
          if (controller.signal.aborted) return;
          setScans((current) => ({ ...current, [id]: 'failed' }));
          setResults((current) =>
            current[id] ? current : { ...current, [id]: { error: true } },
          );
        }
      }
    };
    for (const rows of Map.groupBy(
      datasets,
      ({ provider }) => provider,
    ).values()) {
      const heavy = rows.filter(
        ({ id }) => id.includes('-candles-') || id.startsWith('coinalyze-'),
      );
      const light = rows.filter((row) => !heavy.includes(row));
      void loadRows(heavy.sort((left, right) => right.stepMs - left.stepMs));
      void loadRows(light);
    }
    return () => controller.abort();
  }, [datasets, refresh, revision, year]);

  const ready = Object.values(scans).filter(
    (state) => state === 'ready',
  ).length;
  const failed = Object.values(scans).filter(
    (state) => state === 'failed',
  ).length;

  return (
    <Stack gap={3}>
      {ready + failed < datasets.length && (
        <Text role="status" color="gray.400" fontSize="sm">
          Updating coverage · {ready} of {datasets.length} datasets ready
        </Text>
      )}

      {monthBlock && (
        <Flex align="center" gap={3}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSelection(undefined);
              setMonth(undefined);
            }}
          >
            Back to year
          </Button>
          <Heading as="h2" size="sm">
            {monthBlock.label}
          </Heading>
        </Flex>
      )}
      {providers.size === 0 && (
        <Text color="gray.400">No market data stored for {year}.</Text>
      )}
      {[...providers].map(([provider, rows]) => (
        <Box
          as="section"
          key={provider}
          borderWidth="1px"
          borderColor="gray.700"
          borderRadius="lg"
          bg="gray.800"
        >
          <Grid
            templateColumns={{ base: '1fr', md: '235px minmax(0, 1fr)' }}
            alignItems="center"
            columnGap={4}
            px={3}
            py={2}
          >
            <Heading as="h2" size="sm">
              {provider}
            </Heading>
            <Grid
              templateColumns={`repeat(${blocks.length}, minmax(0, 1fr))`}
              gap={{ base: '2px', md: '3px' }}
              color="gray.400"
              fontSize="xs"
            >
              {blocks.map(({ from }, index) => (
                <Text key={from} textAlign="center" truncate>
                  {monthBlock
                    ? index % 7 === 0
                      ? new Date(from).getUTCDate()
                      : ''
                    : shortMonth.format(from)}
                </Text>
              ))}
            </Grid>
          </Grid>
          {rows.map((dataset) => {
            const scan = scans[dataset.id];
            const result = results[dataset.id];
            return (
              <CoverageRow
                key={`${dataset.id}:${month ?? 'year'}`}
                dataset={dataset}
                year={year}
                blocks={blocks}
                monthView={Boolean(monthBlock)}
                result={result}
                progress={typeof scan === 'object' ? scan : undefined}
                updateFailed={
                  scan === 'failed' && Boolean(result && 'coverage' in result)
                }
                selection={
                  selection?.id === dataset.id ? selection.day : undefined
                }
                onSelect={(day) => {
                  if (!monthBlock) {
                    setMonth(day);
                    return;
                  }
                  setSelection((current) =>
                    current?.id === dataset.id && current.day === day
                      ? undefined
                      : { id: dataset.id, day },
                  );
                }}
              />
            );
          })}
        </Box>
      ))}
    </Stack>
  );
}

export function DataCoverageView({
  datasets,
  latest,
}: {
  datasets: DataCoverageDataset[];
  latest: number;
}) {
  const [tab, setTab] = useState('coverage');
  const [latestEnd, setLatestEnd] = useState(latest);
  const latestYear = new Date(latestEnd - DAY_MS).getUTCFullYear();
  const [year, setYear] = useState(latestYear);
  const [refresh, setRefresh] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const to = Math.min(Date.UTC(year + 1, 0, 1), latestEnd);

  return (
    <Box as="main" pl={2} pr={4} pb={8} maxW="1500px">
      <Stack gap={3}>
        <Flex align="center" justify="space-between" gap={3} wrap="wrap">
          <Heading as="h1" size="lg">
            Data coverage
          </Heading>
          {tab === 'coverage' && (
            <Flex align="center" gap={2} wrap="wrap">
              <Button
                size="sm"
                variant="outline"
                aria-label="Previous year"
                disabled={year <= 1970}
                onClick={() => {
                  setForceRefresh(false);
                  setYear(year - 1);
                }}
              >
                <FiChevronLeft />
              </Button>
              <Text
                minW="52px"
                textAlign="center"
                fontSize="sm"
                aria-live="polite"
              >
                {year}
              </Text>
              <Button
                size="sm"
                variant="outline"
                aria-label="Next year"
                disabled={year === latestYear}
                onClick={() => {
                  setForceRefresh(false);
                  setYear(year + 1);
                }}
              >
                <FiChevronRight />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const nextEnd =
                    (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;
                  setLatestEnd(nextEnd);
                  setYear((current) =>
                    current === latestYear
                      ? new Date(nextEnd - DAY_MS).getUTCFullYear()
                      : current,
                  );
                  setForceRefresh(true);
                  setRefresh((current) => current + 1);
                }}
              >
                Refresh
              </Button>
            </Flex>
          )}
        </Flex>
        <Tabs.Root
          value={tab}
          onValueChange={({ value }) => setTab(value)}
          lazyMount
        >
          <Tabs.List>
            <Tabs.Trigger value="coverage">Coverage</Tabs.Trigger>
            <Tabs.Trigger value="queue">Backfill queue</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="coverage">
            <Stack gap={3}>
              <Text fontSize="sm" color="gray.400">
                Open a month to see daily coverage, then open a day to see its
                instruments or indices. Dates are in UTC.
              </Text>
              <Flex gapX={5} gapY={2} wrap="wrap" aria-label="Coverage legend">
                {legend.map(([color, label]) => (
                  <Flex key={label} align="center" gap={2}>
                    <Box w={3} h={3} borderRadius="sm" bg={color} />
                    <Text fontSize="sm" color="gray.300">
                      {label}
                    </Text>
                  </Flex>
                ))}
              </Flex>
              <CoverageOverview
                key={year}
                revision={refresh}
                datasets={datasets}
                year={year}
                to={to}
                refresh={forceRefresh}
              />
            </Stack>
          </Tabs.Content>
          <Tabs.Content value="queue">
            {tab === 'queue' && <DataBackfillQueue datasets={datasets} />}
          </Tabs.Content>
        </Tabs.Root>
      </Stack>
    </Box>
  );
}
