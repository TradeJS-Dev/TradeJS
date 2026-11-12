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
  Text,
  chakra,
} from '@chakra-ui/react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import type {
  DataCoverage,
  DataCoverageDataset,
  DataCoverageSeriesDay,
} from '@tradejs/types';

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 30;
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

async function loadCoverage<T>(
  dataset: string,
  to: number,
  signal: AbortSignal,
  options: { day?: number; refresh?: boolean } = {},
): Promise<T> {
  const params = new URLSearchParams({ dataset, to: String(to) });
  if (options.day !== undefined) params.set('day', String(options.day));
  if (options.refresh) params.set('refresh', '1');
  const response = await fetch(`/api/data-coverage?${params}`, { signal });
  if (!response.ok) throw new Error('Could not load data coverage.');
  return response.json();
}

function DayDetails({
  dataset,
  to,
  day,
  onClose,
}: {
  dataset: DataCoverageDataset;
  to: number;
  day: number;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<DataCoverageSeriesDay[] | 'error'>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadCoverage<DataCoverageSeriesDay[]>(
      dataset.id,
      to,
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
  }, [dataset.id, day, to]);

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
              </Box>
            ))}
          </Grid>
        </>
      )}
    </Stack>
  );
}

function CoverageRow({
  dataset,
  to,
  days,
  result,
  selection,
  onSelect,
}: {
  dataset: DataCoverageDataset;
  to: number;
  days: number[];
  result?: CoverageResult;
  selection?: number;
  onSelect: (day?: number) => void;
}) {
  const [focusedDay, setFocusedDay] = useState(0);
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
      End: days.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(days.length - 1, target));
    event.currentTarget.parentElement
      ?.querySelectorAll('button')
      [next]?.focus();
  };

  return (
    <Box
      borderTopWidth="1px"
      borderColor="gray.700"
      aria-busy={!result}
      aria-label={
        !result
          ? `Loading ${dataset.provider} ${dataset.label} ${dataset.interval}`
          : undefined
      }
    >
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
          {!result ? (
            <Stack gap="6px" py="3px">
              <Skeleton h="10px" w="135px" />
              <Skeleton h="10px" w="92px" />
            </Stack>
          ) : (
            <Text color={missing ? 'orange.300' : 'gray.400'} fontSize="xs">
              {'error' in result && 'Could not load coverage'}
              {coverage &&
                (coverage.series
                  ? `${number.format(coverage.series)} series · ${number.format(missing)} missing`
                  : 'No data in this period')}
            </Text>
          )}
          {coverage?.first != null && coverage.last != null && (
            <Text color="gray.400" fontSize="xs">
              {date.formatRange(coverage.first, coverage.last)}
            </Text>
          )}
        </Box>
        <Grid
          templateColumns="repeat(30, minmax(0, 1fr))"
          gap={{ base: '2px', md: '3px' }}
          aria-label={`${dataset.provider} ${dataset.label} ${dataset.interval}`}
        >
          {days.map((day, index) => {
            if (!result)
              return <Skeleton key={day} h="24px" borderRadius="sm" />;
            const counts = byDay.get(day);
            const label = `${dataset.provider} ${dataset.label} ${dataset.interval}, ${fullDate.format(day)} UTC`;
            const title = counts
              ? `${label} · ${number.format(counts.loaded)} loaded · ${number.format(counts.missing)} missing · ${number.format(counts.series)} series`
              : `${label} · ${coverage ? 'Outside loaded range' : 'Coverage unavailable'}`;
            const color = !counts
              ? colors.outside
              : counts.missing
                ? counts.loaded
                  ? colors.gaps
                  : colors.missing
                : counts.series < (coverage?.series ?? 0)
                  ? colors.partial
                  : colors.complete;
            return coverage?.series ? (
              <chakra.button
                type="button"
                key={day}
                h="24px"
                minW={0}
                borderRadius="sm"
                bg={color}
                title={title}
                aria-label={title}
                aria-expanded={selection === day}
                aria-controls={selection === day ? detailId : undefined}
                tabIndex={focusedDay === index ? 0 : -1}
                onFocus={() => setFocusedDay(index)}
                onKeyDown={(event) => moveFocus(event, index)}
                onClick={() => onSelect(selection === day ? undefined : day)}
                outline={selection === day ? '2px solid white' : undefined}
                _hover={{ opacity: 0.75 }}
                _focusVisible={{
                  outline: '2px solid white',
                  outlineOffset: '1px',
                }}
              />
            ) : (
              <Box key={day} h="24px" borderRadius="sm" bg={color} />
            );
          })}
        </Grid>
      </Grid>
      {selection !== undefined && (
        <Box id={detailId}>
          <DayDetails
            key={selection}
            dataset={dataset}
            to={to}
            day={selection}
            onClose={() => onSelect()}
          />
        </Box>
      )}
    </Box>
  );
}

function CoverageOverview({
  datasets,
  to,
  refresh,
}: {
  datasets: DataCoverageDataset[];
  to: number;
  refresh: boolean;
}) {
  const [results, setResults] = useState<Record<string, CoverageResult>>({});
  const [selection, setSelection] = useState<{ id: string; day: number }>();
  const from = to - PERIOD_DAYS * DAY_MS;
  const days = Array.from(
    { length: PERIOD_DAYS },
    (_, index) => from + index * DAY_MS,
  );
  const providers = [...new Set(datasets.map(({ provider }) => provider))];

  useEffect(() => {
    const controller = new AbortController();
    // Start with one request per source so each section can populate progressively.
    const queues = Map.groupBy(datasets, ({ provider }) => provider);
    const ordered: DataCoverageDataset[] = [];
    while (ordered.length < datasets.length) {
      for (const queue of queues.values()) {
        const next = queue.shift();
        if (next) ordered.push(next);
      }
    }
    const worker = async () => {
      while (ordered.length && !controller.signal.aborted) {
        const dataset = ordered.shift()!;
        const result = await loadCoverage<DataCoverage>(
          dataset.id,
          to,
          controller.signal,
          { refresh },
        )
          .then((coverage) => ({ coverage }))
          .catch(() => ({ error: true as const }));
        if (!controller.signal.aborted)
          setResults((current) => ({ ...current, [dataset.id]: result }));
      }
    };
    for (let index = 0; index < queues.size; index++) void worker();
    return () => controller.abort();
  }, [datasets, refresh, to]);

  return (
    <Stack gap={3}>
      {providers.map((provider) => (
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
            <Flex justify="space-between" color="gray.400" fontSize="xs">
              {[0, 7, 14, 21, 29].map((index) => (
                <Text key={index}>{date.format(days[index])}</Text>
              ))}
            </Flex>
          </Grid>
          {datasets
            .filter((dataset) => dataset.provider === provider)
            .map((dataset) => (
              <CoverageRow
                key={dataset.id}
                dataset={dataset}
                to={to}
                days={days}
                result={results[dataset.id]}
                selection={
                  selection?.id === dataset.id ? selection.day : undefined
                }
                onSelect={(day) =>
                  setSelection(
                    day === undefined ? undefined : { id: dataset.id, day },
                  )
                }
              />
            ))}
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
  const [latestEnd, setLatestEnd] = useState(latest);
  const [to, setTo] = useState(latest);
  const [refresh, setRefresh] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const period = PERIOD_DAYS * DAY_MS;

  return (
    <Box as="main" pl={2} pr={4} pb={8} maxW="1500px">
      <Stack gap={3}>
        <Flex align="center" justify="space-between" gap={3} wrap="wrap">
          <Heading as="h1" size="lg">
            Data coverage
          </Heading>
          <Flex align="center" gap={2} wrap="wrap">
            <Button
              size="sm"
              variant="outline"
              aria-label="Previous 30 days"
              onClick={() => {
                setForceRefresh(false);
                setTo(to - period);
              }}
            >
              <FiChevronLeft />
            </Button>
            <Text minW="185px" textAlign="center" fontSize="sm">
              {fullDate.formatRange(to - period, to - DAY_MS)} UTC
            </Text>
            <Button
              size="sm"
              variant="outline"
              aria-label="Next 30 days"
              disabled={to === latestEnd}
              onClick={() => {
                setForceRefresh(false);
                setTo(Math.min(latestEnd, to + period));
              }}
            >
              <FiChevronRight />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const nextEnd = (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;
                setLatestEnd(nextEnd);
                setTo((current) => (current === latestEnd ? nextEnd : current));
                setForceRefresh(true);
                setRefresh((current) => current + 1);
              }}
            >
              Refresh
            </Button>
          </Flex>
        </Flex>
        <Text fontSize="sm" color="gray.400">
          Each block is one UTC day across all stored series. Open a block to
          see the affected instruments or indices.
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
          key={`${to}:${refresh}`}
          datasets={datasets}
          to={to}
          refresh={forceRefresh}
        />
      </Stack>
    </Box>
  );
}
