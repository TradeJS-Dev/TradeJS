'use client';

import {
  Box,
  Button,
  CloseButton,
  Dialog,
  Drawer,
  Flex,
  IconButton,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
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
    case 'error':
      return 'fg.error';
    default:
      return 'gray.200';
  }
};

const StrategySnapshotDetailsDrawer = ({
  snapshot,
}: {
  snapshot: StrategyChartSnapshot;
}) => {
  if (!snapshot.details?.length) {
    return null;
  }

  return (
    <Drawer.Root size="md">
      <Drawer.Trigger asChild>
        <Button size="sm" variant="outline" ml="auto">
          Details
        </Button>
      </Drawer.Trigger>
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
                  {snapshot.details.map((detail) => (
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
  );
};

export const StrategySnapshotCard = ({
  snapshot,
  emptyText,
  mode,
  onDeleted,
}: {
  snapshot: StrategyChartSnapshot;
  emptyText: string;
  mode: 'replay' | 'ai';
  onDeleted?: (cardId: string) => void;
}) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const symbolsLabel =
    snapshot.symbols.length > 3
      ? `${snapshot.symbols.slice(0, 3).join(', ')} +${snapshot.symbols.length - 3}`
      : snapshot.symbols.join(', ') || 'n/a';

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
        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {snapshot.title}
        </Text>

        {snapshot.subtitle ? (
          <Text fontSize="sm" color="gray.400">
            {snapshot.subtitle}
          </Text>
        ) : null}

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            symbols:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {symbolsLabel}
          </Text>
        </Flex>

        <StrategySnapshotDetailsDrawer snapshot={snapshot} />

        <Dialog.Root
          open={deleteOpen}
          onOpenChange={(e) => setDeleteOpen(e.open)}
        >
          <Dialog.Trigger asChild>
            <IconButton
              size="sm"
              colorPalette="red"
              variant="outline"
              aria-label="Delete strategy card"
            >
              <FiTrash2 />
            </IconButton>
          </Dialog.Trigger>
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
        {snapshot.metrics.map((metric) => (
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
