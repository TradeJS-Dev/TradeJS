'use client';

import {
  Button,
  CloseButton,
  Drawer,
  Portal,
  Text,
  Textarea,
} from '@chakra-ui/react';
import type { RuntimeStrategyView } from '@tradejs/types';

export const RuntimeStrategyConfigDrawer = ({
  open,
  strategy,
  onOpenChange,
}: {
  open: boolean;
  strategy: RuntimeStrategyView;
  onOpenChange: (open: boolean) => void;
}) => (
  <Drawer.Root
    size="lg"
    open={open}
    onOpenChange={(event) => onOpenChange(event.open)}
  >
    <Portal>
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content bg="gray.950">
          <Drawer.Header>
            <Drawer.Title>
              {strategy.strategyName} release v{strategy.releaseVersion}
            </Drawer.Title>
            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Drawer.CloseTrigger>
          </Drawer.Header>
          <Drawer.Body display="flex" flexDirection="column" gap={4}>
            <Text color="gray.400">
              Published releases are immutable. Roll out a new release to change
              this configuration.
            </Text>
            <Textarea
              value={JSON.stringify(strategy.config, null, 2)}
              readOnly
              minH="70vh"
              fontFamily="mono"
              fontSize="sm"
            />
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
