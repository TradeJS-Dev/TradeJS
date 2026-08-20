'use client';

import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import type { StrategyChartSnapshot } from '@tradejs/types';
import { OrdersDrawerPanel } from '#components/Shared/OrdersDrawer';
import { deleteStrategyCard } from '#actions/strategies';
import { toaster } from '#ui';
import { StrategySnapshotChart } from './StrategySnapshotChart';
import { StrategySnapshotCardDetailsDrawer } from './StrategySnapshotCardDetailsDrawer';
import {
  buildStrategySnapshotCardViewModel,
  getMetricColor,
  SNAPSHOT_ORDER_ROW_HEIGHT,
} from './StrategySnapshotCard.presenter';

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
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const viewModel = useMemo(
    () => buildStrategySnapshotCardViewModel(snapshot, mode),
    [mode, snapshot],
  );
  const {
    snapshotOrders,
    sourceLabel,
    sourceValue,
    generatedAtLabel,
    tagsLabel,
    displaySubtitle,
    metrics,
    hasOrdersDrawer,
    hasStatDrawer,
  } = viewModel;

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

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            {sourceLabel}
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {sourceValue}
          </Text>
        </Flex>

        {generatedAtLabel ? (
          <Flex gap="1">
            <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
              generated:
            </Text>
            <Text fontSize="sm" color="gray.300" mt={1}>
              {generatedAtLabel}
            </Text>
          </Flex>
        ) : null}

        {tagsLabel ? (
          <Box
            px={2}
            py={1}
            borderWidth="1px"
            borderColor="teal.900"
            borderRadius="sm"
            bg="teal.950"
            color="teal.300"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="semibold"
            lineHeight="1"
          >
            {tagsLabel}
          </Box>
        ) : null}

        <Flex ml="auto" align="center" gap={3}>
          {displaySubtitle ? (
            <Box
              order={0}
              px={2}
              py={1}
              borderWidth="1px"
              borderColor="gray.700"
              borderRadius="sm"
              bg="gray.800"
              color="gray.200"
              fontFamily="mono"
              fontSize="sm"
              fontWeight="semibold"
              lineHeight="1"
            >
              {displaySubtitle}
            </Box>
          ) : null}

          <Box order={1}>
            <Menu.Root positioning={{ placement: 'bottom-end' }}>
              <Menu.Trigger asChild>
                <Button size="sm" variant="outline">
                  Actions
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content minW="160px">
                    {hasOrdersDrawer ? (
                      <Menu.Item
                        value="orders"
                        onClick={() => setOrdersOpen(true)}
                      >
                        Orders
                      </Menu.Item>
                    ) : null}
                    {hasStatDrawer ? (
                      <Menu.Item
                        value="stat"
                        onClick={() => setDetailsOpen(true)}
                      >
                        Stat
                      </Menu.Item>
                    ) : null}
                    {hasStatDrawer ? <Menu.Separator /> : null}
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
          </Box>
        </Flex>

        <OrdersDrawerPanel
          title={`${snapshot.title} orders`}
          open={ordersOpen}
          orders={snapshotOrders}
          rowHeight={SNAPSHOT_ORDER_ROW_HEIGHT}
          showStatusFilter={false}
          emptyText={
            mode === 'replay'
              ? 'No replay order points for this card.'
              : 'No AI order points for this card.'
          }
          onOpenChange={setOrdersOpen}
        />

        <StrategySnapshotCardDetailsDrawer
          snapshot={snapshot}
          mode={mode}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          viewModel={viewModel}
        />

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
      </Flex>

      <StrategySnapshotChart
        orderLog={snapshot.orderLog}
        orders={snapshot.orders}
        mode={mode}
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
