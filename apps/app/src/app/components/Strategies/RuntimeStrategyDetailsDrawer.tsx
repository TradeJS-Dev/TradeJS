'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  CloseButton,
  Drawer,
  Image,
  Portal,
  SimpleGrid,
  Spinner,
  Stat,
  Text,
} from '@chakra-ui/react';
import type { RuntimeLaunchReportResponse } from '@tradejs/types';

type ReportState =
  | { status: 'loading' | 'error' }
  | { status: 'loaded'; data: RuntimeLaunchReportResponse | null };

const date = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const decimal = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

const ReportContent = ({ data }: { data: RuntimeLaunchReportResponse }) => {
  const { report, chartUrl } = data;
  const { metrics, period, chart } = report;
  const values = [
    ['Win rate', metrics.winRatePercent, '%'],
    ['Longest time underwater', metrics.maxDrawdownDurationDays, ' days'],
    ['Max loss streak', metrics.maxLossStreak, ''],
    ['Max drawdown (USDT)', metrics.maxDrawdown, ''],
    ['Closed trades', metrics.trades, ''],
    ['Profit factor', metrics.profitFactor, ''],
    ['Net P&L (USDT)', metrics.pnl, ''],
  ] as const;
  return (
    <>
      <Box>
        <Text fontWeight="semibold" overflowWrap="anywhere">
          {report.candidate}
        </Text>
        {period && (
          <Text color="gray.400" fontSize="sm">
            {date.formatRange(period.start, period.end)} (UTC)
          </Text>
        )}
        {report.researchRiskUsdt !== undefined && (
          <Text color="gray.400" fontSize="sm">
            Backtest risk per trade {decimal.format(report.researchRiskUsdt)}{' '}
            USDT
          </Text>
        )}
        {report.note && (
          <Text color="gray.400" fontSize="sm" mt={2}>
            {report.note}
          </Text>
        )}
      </Box>
      <SimpleGrid columns={{ base: 2, md: 3 }} gap={4}>
        {values.map(([label, value, suffix]) => (
          <Stat.Root
            key={label}
            minW={0}
            p={3}
            borderWidth="1px"
            borderRadius="md"
          >
            <Stat.Label whiteSpace="normal">{label}</Stat.Label>
            <Stat.ValueText fontVariantNumeric="tabular-nums">
              {value === undefined ? '—' : `${decimal.format(value)}${suffix}`}
            </Stat.ValueText>
          </Stat.Root>
        ))}
      </SimpleGrid>
      {chart && chartUrl ? (
        <Box as="figure" m={0}>
          <Image
            src={chartUrl}
            alt={chart.caption}
            w="full"
            borderRadius="md"
          />
          <Box as="figcaption" mt={2} color="gray.400" fontSize="sm">
            {chart.caption}
          </Box>
        </Box>
      ) : (
        <Text color="gray.400">
          No chart was retained for this launch report.
        </Text>
      )}
    </>
  );
};

const LaunchReport = ({
  deploymentId,
  strategyName,
}: {
  deploymentId: string;
  strategyName: string;
}) => {
  const [state, setState] = useState<ReportState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ deploymentId, strategyName });
    void fetch(`/api/strategies/runtime/details?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load launch report');
        const data: RuntimeLaunchReportResponse | null = await response.json();
        if (!controller.signal.aborted) setState({ status: 'loaded', data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [deploymentId, strategyName]);

  if (state.status === 'loading')
    return <Spinner role="status" aria-label="Loading launch report" />;
  if (state.status === 'error')
    return (
      <Text role="alert">
        Could not load the launch report. Reopen Details to try again.
      </Text>
    );
  if (state.status === 'loaded' && state.data)
    return <ReportContent data={state.data} />;
  return (
    <Text role="status">No launch report is linked to this deployment.</Text>
  );
};

export const RuntimeStrategyDetailsDrawer = ({
  open,
  strategyName,
  deploymentId,
  deploymentLabel,
  onOpenChange,
}: {
  open: boolean;
  strategyName: string;
  deploymentId: string;
  deploymentLabel: string;
  onOpenChange: (open: boolean) => void;
}) => (
  <Drawer.Root
    size={{ base: 'full', md: 'xl' }}
    open={open}
    onOpenChange={(event) => onOpenChange(event.open)}
  >
    <Portal>
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content bg="gray.950">
          <Drawer.Header>
            <Drawer.Title>
              {strategyName}, {deploymentLabel} launch report
            </Drawer.Title>
            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Header>
          <Drawer.Body
            display="flex"
            flexDirection="column"
            gap={4}
            overflowY="auto"
          >
            {open && (
              <LaunchReport
                key={JSON.stringify([deploymentId, strategyName])}
                deploymentId={deploymentId}
                strategyName={strategyName}
              />
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Positioner>
    </Portal>
  </Drawer.Root>
);
