'use client';

import { Badge, Box, Button, Flex, Grid, Stack, Text } from '@chakra-ui/react';
import {
  FiFolder,
  FiPause,
  FiPlay,
  FiSquare,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import type {
  BacktestJobRecord,
  BacktestJobStatus,
} from '#app/lib/backtestJobContracts';
import type { JobAction } from './useBacktestRunsController';

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

interface BacktestJobItemProps {
  job: BacktestJobRecord;
  busyAction: string;
  onAction: (jobId: string, action: JobAction) => void;
  onDelete: (jobId: string) => void;
  onOpenResults: () => void;
}

export const BacktestJobItem = ({
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
              variant="ghost"
              colorPalette="red"
              loading={busyAction === `${job.id}:cancel`}
              onClick={() => onAction(job.id, 'cancel')}
            >
              <FiX />
              Cancel
            </Button>
          ) : null}

          <Button
            type="button"
            size="xs"
            variant="ghost"
            colorPalette="red"
            disabled={!canDelete}
            loading={busyAction === `${job.id}:delete`}
            onClick={() => onDelete(job.id)}
          >
            <FiTrash2 />
          </Button>
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
