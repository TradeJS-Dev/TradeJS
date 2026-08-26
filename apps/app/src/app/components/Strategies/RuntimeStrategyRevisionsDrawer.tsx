'use client';

import { useMemo } from 'react';
import {
  Badge,
  Box,
  Button,
  CloseButton,
  Drawer,
  Flex,
  Portal,
  Text,
} from '@chakra-ui/react';
import type {
  RuntimeStrategyRevisionChange,
  RuntimeStrategyView,
} from '@tradejs/types';
import { formatDateTime } from '#components/Shared/OrdersDrawer';

interface RuntimeStrategyRevisionItem {
  strategyRevision: string;
  changedAt: number | null;
  current: boolean;
}

export const buildRuntimeStrategyRevisionItems = ({
  strategyRevision,
  revisionChanges,
}: {
  strategyRevision: string;
  revisionChanges: RuntimeStrategyRevisionChange[];
}): RuntimeStrategyRevisionItem[] => {
  const changedAtByRevision = new Map<string, number>();

  for (const change of revisionChanges) {
    const previousTimestamp = changedAtByRevision.get(change.strategyRevision);
    if (
      Number.isFinite(change.timestamp) &&
      (previousTimestamp == null || change.timestamp > previousTimestamp)
    ) {
      changedAtByRevision.set(change.strategyRevision, change.timestamp);
    }
  }

  const revisions = new Set([strategyRevision, ...changedAtByRevision.keys()]);

  return [...revisions]
    .map((revision) => ({
      strategyRevision: revision,
      changedAt: changedAtByRevision.get(revision) ?? null,
      current: revision === strategyRevision,
    }))
    .sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return (right.changedAt ?? 0) - (left.changedAt ?? 0);
    });
};

export const RuntimeStrategyRevisionsDrawer = ({
  open,
  strategy,
  onOpenChange,
}: {
  open: boolean;
  strategy: RuntimeStrategyView;
  onOpenChange: (open: boolean) => void;
}) => {
  const revisions = useMemo(
    () =>
      buildRuntimeStrategyRevisionItems({
        strategyRevision: strategy.strategyRevision,
        revisionChanges: strategy.revisionChanges,
      }),
    [strategy.revisionChanges, strategy.strategyRevision],
  );

  return (
    <Drawer.Root
      size="md"
      open={open}
      onOpenChange={(event) => onOpenChange(event.open)}
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="gray.950">
            <Drawer.Header>
              <Drawer.Title>{strategy.strategyName} revisions</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>
            <Drawer.Body
              display="flex"
              flexDirection="column"
              gap={3}
              overflowY="auto"
            >
              <Text color="gray.400">
                Current revision and all revision changes recorded in the
                selected runtime window.
              </Text>

              {revisions.map((revision) => (
                <Box
                  key={revision.strategyRevision}
                  p={4}
                  borderWidth="1px"
                  borderColor={revision.current ? 'teal.800' : 'gray.800'}
                  borderRadius="md"
                  bg="gray.900"
                >
                  <Flex
                    alignItems="center"
                    justifyContent="space-between"
                    gap={3}
                  >
                    <Text fontSize="xs" color="gray.500">
                      Strategy revision
                    </Text>
                    {revision.current ? (
                      <Badge colorPalette="teal" variant="subtle">
                        Current
                      </Badge>
                    ) : null}
                  </Flex>
                  <Text
                    mt={2}
                    fontFamily="mono"
                    fontSize="sm"
                    color="gray.200"
                    overflowWrap="anywhere"
                  >
                    {revision.strategyRevision}
                  </Text>
                  <Text mt={2} fontSize="xs" color="gray.500">
                    {revision.changedAt == null
                      ? 'No revision change recorded in this window'
                      : `Changed at ${formatDateTime(revision.changedAt)}`}
                  </Text>
                </Box>
              ))}
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
