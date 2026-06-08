'use client';

import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Drawer,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { useState } from 'react';
import type {
  StrategyChartMetric,
  StrategyChartSnapshot,
} from '@tradejs/types';
import { deleteStrategyCard } from '#actions/strategies';
import { toaster } from '#ui';
import { StrategySnapshotChart } from './StrategySnapshotChart';

const getMetricColor = (tone: StrategyChartMetric['tone']) => {
  switch (tone) {
    case 'success':
      return 'teal.500';
    case 'warning':
      return 'fg.warning';
    case 'neutral':
      return 'gray.300';
    case 'error':
      return 'fg.error';
    default:
      return 'gray.200';
  }
};

const calculateMaxDrawdownPercent = (orderLog: Array<[number, number]>) => {
  if (!orderLog.length) {
    return null;
  }

  let peak = orderLog[0]?.[1] ?? 0;
  let maxDrawdownPercent = 0;

  for (const [, amount] of orderLog) {
    if (!Number.isFinite(amount)) {
      continue;
    }

    peak = Math.max(peak, amount);
    if (peak <= 0) {
      continue;
    }

    const drawdownPercent = ((peak - amount) / peak) * 100;
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
  }

  return `${maxDrawdownPercent.toFixed(1)}%`;
};

export const StrategySnapshotCard = ({
  snapshot,
  emptyText,
  mode,
  onDeleted,
  selected = false,
  onToggleSelection,
}: {
  snapshot: StrategyChartSnapshot;
  emptyText: string;
  mode: 'replay' | 'ai';
  onDeleted?: (cardId: string) => void;
  selected?: boolean;
  onToggleSelection?: (cardId: string, checked: boolean) => void;
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const symbolsLabel =
    snapshot.symbols.length > 3
      ? `${snapshot.symbols.slice(0, 3).join(', ')} +${snapshot.symbols.length - 3}`
      : snapshot.symbols.join(', ') || 'n/a';
  const sourceLabel =
    mode === 'ai' && snapshot.datasetId ? 'dataset:' : 'symbols:';
  const sourceValue =
    mode === 'ai' && snapshot.datasetId ? snapshot.datasetId : symbolsLabel;
  const displaySubtitle =
    mode === 'ai'
      ? snapshot.subtitle?.replace(/^q\d+\+\s*(?:·\s*)?/i, '').trim()
      : snapshot.subtitle;
  const metrics =
    mode === 'ai'
      ? snapshot.metrics.map((metric) =>
          metric.id === 'quality' || metric.label === 'Quality'
            ? {
                id: 'maxDrawdown',
                label: 'Max drawdown',
                value: calculateMaxDrawdownPercent(snapshot.orderLog) ?? 'n/a',
                tone: 'warning' as const,
              }
            : metric,
        )
      : snapshot.metrics;

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);
    try {
      const deleted = await deleteStrategyCard(mode, snapshot.cardId);
      if (!deleted) {
        toaster.error({
          title: 'Delete failed',
          description: 'Strategy card was not deleted.',
        });
        return;
      }

      onDeleted?.(snapshot.cardId);
      setDeleteOpen(false);
      toaster.success({
        title: 'Strategy card deleted',
        description: snapshot.title,
      });
    } catch {
      toaster.error({
        title: 'Delete failed',
        description: 'Unexpected error while deleting strategy card.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Box
      p={2}
      mb={4}
      maxW="1400px"
      borderRadius="md"
      shadow="sm"
      borderWidth="1px"
      borderColor="gray.800"
      overflowX="auto"
    >
      <Flex gap="4" p={4} mb={3} alignItems="center" wrap="wrap">
        {onToggleSelection ? (
          <Checkbox.Root
            size="sm"
            colorPalette="teal"
            checked={selected}
            onCheckedChange={(details) =>
              onToggleSelection(snapshot.cardId, details.checked === true)
            }
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control bg="gray.800" borderColor="gray.500" />
          </Checkbox.Root>
        ) : null}

        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {snapshot.title}
        </Text>

        {displaySubtitle ? (
          <Text fontSize="sm" color="gray.400">
            {displaySubtitle}
          </Text>
        ) : null}

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            {sourceLabel}
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {sourceValue}
          </Text>
        </Flex>

        <Menu.Root positioning={{ placement: 'bottom-end' }}>
          <Menu.Trigger asChild>
            <Button size="sm" variant="outline" ml="auto">
              Actions
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content minW="160px">
                {snapshot.details?.length ? (
                  <Menu.Item value="stat" onClick={() => setDetailsOpen(true)}>
                    Stat
                  </Menu.Item>
                ) : null}
                {snapshot.details?.length ? <Menu.Separator /> : null}
                <Menu.Item
                  value="delete"
                  color="fg.error"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>

        <Drawer.Root
          size="md"
          open={detailsOpen}
          onOpenChange={(e) => setDetailsOpen(e.open)}
        >
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content display="flex" flexDirection="column">
                <Drawer.Header>
                  <Drawer.Title>{snapshot.title}</Drawer.Title>
                  <Drawer.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Drawer.CloseTrigger>
                </Drawer.Header>

                <Drawer.Body overflowY="auto">
                  <Box
                    p={4}
                    borderWidth="1px"
                    borderColor="gray.800"
                    borderRadius="xl"
                    bg="gray.950"
                  >
                    <Text fontSize="sm" color="gray.500" mb={4}>
                      {snapshot.subtitle || 'AI train details'}
                    </Text>

                    <SimpleGrid columns={1} gap={3}>
                      {snapshot.details?.map((detail) => (
                        <Flex
                          key={detail.id}
                          justify="space-between"
                          align="flex-start"
                          gap={4}
                          p={3}
                          borderRadius="lg"
                          bg="blackAlpha.400"
                        >
                          <Text
                            fontSize="sm"
                            color="gray.400"
                            fontFamily="mono"
                            flex="0 0 220px"
                          >
                            {detail.label}
                          </Text>
                          <Text
                            fontSize="sm"
                            color={getMetricColor(detail.tone)}
                            fontWeight="semibold"
                            textAlign="right"
                            fontFamily="mono"
                            whiteSpace="pre-wrap"
                          >
                            {detail.value}
                          </Text>
                        </Flex>
                      ))}
                    </SimpleGrid>
                  </Box>
                </Drawer.Body>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>

        <Dialog.Root
          open={deleteOpen}
          onOpenChange={(e) => setDeleteOpen(e.open)}
        >
          <Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content>
                <Dialog.Header>
                  <Dialog.Title>Delete card</Dialog.Title>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton position="absolute" right="3" top="3" />
                  </Dialog.CloseTrigger>
                </Dialog.Header>
                <Dialog.Body>
                  <Text fontSize="sm" color="gray.200">
                    Delete strategy card <b>{snapshot.title}</b>?
                  </Text>
                  <Text fontSize="sm" color="gray.400" mt={2}>
                    This action cannot be undone.
                  </Text>
                </Dialog.Body>
                <Dialog.Footer>
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isDeleting}>
                      Cancel
                    </Button>
                  </Dialog.ActionTrigger>
                  <Button
                    colorPalette="red"
                    size="sm"
                    onClick={handleDelete}
                    loading={isDeleting}
                  >
                    Delete
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>

        {snapshot.tags?.length ? (
          <Text fontSize="sm" color="gray.500">
            {snapshot.tags.join(' · ')}
          </Text>
        ) : null}
      </Flex>

      <StrategySnapshotChart
        orderLog={snapshot.orderLog}
        emptyText={emptyText}
      />

      <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
        {metrics.map((metric) => (
          <Stat.Root key={metric.id} size="md">
            <Stat.Label>{metric.label}</Stat.Label>
            <Stat.ValueText color={getMetricColor(metric.tone)}>
              {metric.value}
            </Stat.ValueText>
          </Stat.Root>
        ))}
      </SimpleGrid>
    </Box>
  );
};
