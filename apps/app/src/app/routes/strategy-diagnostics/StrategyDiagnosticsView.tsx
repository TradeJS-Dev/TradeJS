'use client';

import { PageAction, PageHeader, PageLayout } from '#shared/PageLayout';

import { useEffect, useState } from 'react';
import {
  Button,
  Flex,
  Grid,
  Input,
  Link,
  Skeleton,
  Stack,
  Text,
} from '@chakra-ui/react';
import { Select } from '#ui';
import { buildDashboardPath } from '#app/lib/marketRoutes';
import type {
  DiagnosticReport,
  StrategyComparison,
} from '#app/lib/strategyDiagnosticContracts';

type Case = StrategyComparison['cases'][number];
type Trade = NonNullable<Case['runtime']>;

const utc = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 8 });
const differs = (left: number | undefined, right: number | undefined) =>
  left !== undefined && right !== undefined && left !== right;
const differsOnExecution = (item: Case) =>
  item.category === 'matched' &&
  (differs(item.runtime?.price, item.replay?.price) ||
    differs(item.runtime?.quantity, item.replay?.quantity));

const categories = {
  matched: 'Matched',
  runtimeOnly: 'Runtime only',
  backtestOnly: 'Replay only',
};

function TradeSide({
  value,
  provider,
  item,
  runtime,
}: {
  value: Trade | null;
  provider: string;
  item: Case;
  runtime?: boolean;
}) {
  if (!value)
    return (
      <Text fontSize="sm" color="gray.400">
        No trade recorded
      </Text>
    );
  const params = new URLSearchParams({ autoZoom: 'true' });
  if (value.signalId) params.set('signalId', value.signalId);
  const href = buildDashboardPath(
    {
      provider: encodeURIComponent(provider),
      universe: item.universe,
      symbol: encodeURIComponent(item.symbol),
      interval: /^\d+$/.test(item.interval ?? '') ? item.interval! : '15',
    },
    params,
  );
  return (
    <Stack gap={1} fontSize="sm">
      {value.time ? <Text>{utc.format(value.time)} UTC</Text> : null}
      {value.price !== undefined && (
        <Text>Entry {decimal.format(value.price)}</Text>
      )}
      {value.exitPrice !== undefined && (
        <Text>Exit {decimal.format(value.exitPrice)}</Text>
      )}
      {value.quantity !== undefined && (
        <Text>Quantity {decimal.format(value.quantity)}</Text>
      )}
      {value.pnl !== undefined && (
        <Text color={value.pnl >= 0 ? 'teal.300' : 'red.300'}>
          PnL {decimal.format(value.pnl)}
        </Text>
      )}
      {runtime && value.orderId && (
        <Text color="gray.400" overflowWrap="anywhere">
          Order {value.orderId}
        </Text>
      )}
      {value.signalId && (
        <Text color="gray.400" overflowWrap="anywhere">
          Signal {value.signalId}
        </Text>
      )}
      {value.signalId && (
        <Link href={href} color="teal.300" alignSelf="start">
          Open instrument chart
        </Link>
      )}
    </Stack>
  );
}

async function getReport<T>(signal: AbortSignal, id?: string): Promise<T> {
  const response = await fetch(
    `/api/strategy-diagnostics${id ? `?report=${id}` : ''}`,
    { signal },
  );
  if (!response.ok) throw new Error('Could not load strategy diagnostics.');
  return response.json();
}

export function StrategyDiagnosticsView({
  initialReport,
  initialCase,
}: {
  initialReport?: string;
  initialCase?: string;
}) {
  const [reports, setReports] = useState<DiagnosticReport[]>();
  const [truncated, setTruncated] = useState(false);
  const [reportId, setReportId] = useState(initialReport ?? '');
  const [caseId, setCaseId] = useState(initialCase);
  const [result, setResult] = useState<{
    id: string;
    data: StrategyComparison;
  }>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [strategy, setStrategy] = useState('');
  const [symbol, setSymbol] = useState('');
  const [category, setCategory] = useState('mismatches');
  const [limit, setLimit] = useState(30);

  useEffect(() => {
    const controller = new AbortController();
    void getReport<{ items: DiagnosticReport[]; truncated: boolean }>(
      controller.signal,
    )
      .then(({ items, truncated }) => {
        if (controller.signal.aborted) return;
        setReports(items);
        setTruncated(truncated);
        setReportId((current) =>
          current === initialReport || items.some(({ id }) => id === current)
            ? current
            : items[0]?.id ?? '',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not load saved diagnostic reports.');
      });
    return () => controller.abort();
  }, [initialReport, revision]);

  useEffect(() => {
    if (!reportId) return;
    const controller = new AbortController();
    void getReport<StrategyComparison>(controller.signal, reportId)
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ id: reportId, data });
        setStrategy(
          data.strategies.find((row) => row.runtimeOnly || row.backtestOnly)
            ?.name ??
            data.strategies[0]?.name ??
            '',
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Could not open the selected report.');
      });
    return () => controller.abort();
  }, [reportId, revision]);

  const data = result?.id === reportId ? result?.data : undefined;
  const selected = data?.strategies.find((row) => row.name === strategy);
  const filteredCases =
    data?.cases.filter(
      (item) =>
        (!strategy || item.strategy === strategy) &&
        item.symbol.toUpperCase().includes(symbol.trim().toUpperCase()) &&
        (category === 'all' ||
          (category === 'mismatches'
            ? item.category !== 'matched'
            : category === 'execution'
              ? differsOnExecution(item)
              : item.category === category)),
    ) ?? [];

  const cases = caseId
    ? data?.cases.filter((item) => item.id === caseId) ?? []
    : filteredCases;
  const reportOptions = (reports ?? []).map(
    ({ id, deploymentId, window, label }) => ({
      value: id,
      label: `${utc.format(window.startTime)} to ${utc.format(window.endTime)} · ${deploymentId}`,
      description: label,
    }),
  );
  if (reportId && !reportOptions.some(({ value }) => value === reportId)) {
    reportOptions.unshift({
      value: reportId,
      label: 'Linked report',
      description: reportId.slice(0, 8),
    });
  }

  return (
    <PageLayout>
      <Stack gap={4}>
        <PageHeader
          title="Strategy diagnostics"
          actions={
            <PageAction
              onClick={() => {
                setError('');
                setResult(undefined);
                setRevision((value) => value + 1);
              }}
            >
              Refresh
            </PageAction>
          }
        />
        {error && (
          <Text role="alert" color="red.300">
            {error}
          </Text>
        )}
        {!reports && !error && (
          <Skeleton h="130px" aria-label="Loading diagnostic reports" />
        )}
        {reports?.length === 0 && (
          <Text color="gray.400">
            No verified Runtime and Replay reports are available on this host.
          </Text>
        )}
        {Boolean(reports?.length) && (
          <Grid
            gap={3}
            templateColumns={{ base: '1fr', md: '2fr 1fr 1fr 1fr' }}
          >
            <Stack as="label" gap={1} minW={0}>
              <Text fontSize="sm">Report period (UTC)</Text>
              <Select
                aria-label="Report period (UTC)"
                width="100%"
                defaultValue={[]}
                value={reportId ? [reportId] : []}
                items={reportOptions}
                onChange={([id]) => {
                  setReportId(id ?? '');
                  setCaseId(undefined);
                  setError('');
                  setLimit(30);
                }}
              />
            </Stack>
            <Stack as="label" gap={1}>
              <Text fontSize="sm">Strategy</Text>
              <Select
                aria-label="Strategy"
                width="100%"
                disabled={!data}
                defaultValue={[]}
                value={[strategy || 'all']}
                items={[
                  { value: 'all', label: 'All strategies' },
                  ...(data?.strategies ?? []).map(({ name }) => ({
                    value: name,
                    label: name,
                  })),
                ]}
                onChange={([name]) => {
                  setStrategy(name === 'all' ? '' : name ?? '');
                  setLimit(30);
                }}
              />
            </Stack>
            <Stack as="label" gap={1}>
              <Text fontSize="sm">Instrument</Text>
              <Input
                size="sm"
                value={symbol}
                placeholder="BTCUSDT"
                onChange={(event) => {
                  setSymbol(event.target.value);
                  setLimit(30);
                }}
              />
            </Stack>
            <Stack as="label" gap={1}>
              <Text fontSize="sm">Cases</Text>
              <Select
                aria-label="Cases"
                width="100%"
                defaultValue={[]}
                value={[category]}
                items={[
                  { value: 'mismatches', label: 'Differences' },
                  { value: 'all', label: 'All cases' },
                  { value: 'execution', label: 'Price or quantity differs' },
                  ...Object.entries(categories).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
                onChange={([value]) => {
                  setCategory(value ?? 'mismatches');
                  setLimit(30);
                }}
              />
            </Stack>
          </Grid>
        )}
        {truncated && (
          <Text fontSize="sm" color="gray.400">
            Showing the most recent verified reports found on this host.
          </Text>
        )}
        {reportId && !data && !error && (
          <Skeleton h="180px" aria-label="Loading comparison" />
        )}
        {data && (
          <Stack gap={3}>
            <Flex gap={5} wrap="wrap" color="gray.400" fontSize="sm">
              {Object.entries(categories).map(([key, label]) => {
                const metric = key as keyof typeof categories;
                return (
                  <Text key={key}>
                    {label}{' '}
                    <Text as="span" color="white" fontWeight="semibold">
                      {selected?.[metric] ??
                        data.strategies.reduce(
                          (sum, row) => sum + row[metric],
                          0,
                        )}
                    </Text>
                  </Text>
                );
              })}
            </Flex>
            {caseId && (
              <Button
                size="sm"
                variant="outline"
                alignSelf="start"
                onClick={() => setCaseId(undefined)}
              >
                Back to report cases
              </Button>
            )}
            {cases.length === 0 && (
              <Text color="gray.400">No cases match the selected filters.</Text>
            )}
            {cases.slice(0, limit).map((item) => (
              <Stack
                key={item.id}
                gap={2}
                borderWidth="1px"
                borderColor="gray.700"
                borderRadius="md"
                p={3}
              >
                <Flex align="baseline" gap={3} wrap="wrap">
                  <Text fontWeight="semibold">
                    {item.symbol} {item.direction}
                  </Text>
                  <Text color="gray.400" fontSize="sm">
                    {item.strategy}
                  </Text>
                  <Text
                    fontSize="sm"
                    color={
                      item.category === 'matched' ? 'teal.300' : 'orange.300'
                    }
                  >
                    {categories[item.category]}
                  </Text>
                  <Link
                    href={`?report=${reportId}&case=${item.id}`}
                    fontSize="sm"
                    color="teal.300"
                  >
                    Open case
                  </Link>
                </Flex>
                <Grid gap={3} templateColumns="repeat(2, minmax(0, 1fr))">
                  <Stack bg="gray.900" p={2} gap={1}>
                    <Text fontWeight="medium">Runtime</Text>
                    <TradeSide
                      value={item.runtime}
                      provider={data.provider}
                      item={item}
                      runtime
                    />
                  </Stack>
                  <Stack bg="gray.900" p={2} gap={1}>
                    <Text fontWeight="medium">Replay</Text>
                    <TradeSide
                      value={item.replay}
                      provider={data.provider}
                      item={item}
                    />
                  </Stack>
                </Grid>
                {item.reason && <Text fontSize="sm">{item.reason}</Text>}
                {item.decision && item.decision !== item.reason && (
                  <Text fontSize="sm" color="gray.400">
                    {item.decision}
                  </Text>
                )}
                {item.evaluationId && (
                  <Text fontSize="xs" color="gray.400" overflowWrap="anywhere">
                    Evaluation {item.evaluationId}
                  </Text>
                )}
              </Stack>
            ))}
            {cases.length > limit && (
              <Button
                alignSelf="start"
                variant="outline"
                onClick={() => setLimit(limit + 30)}
              >
                Show more cases
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </PageLayout>
  );
}
