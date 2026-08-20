'use client';

import {
  Box,
  Button,
  Clipboard,
  CloseButton,
  Drawer,
  Flex,
  IconButton,
  Portal,
  SimpleGrid,
  Text,
  Textarea,
} from '@chakra-ui/react';
import type { RuntimeStrategyView } from '@tradejs/types';

export const RuntimeStrategyConfigDrawer = ({
  open,
  strategy,
  provider,
  onOpenChange,
}: {
  open: boolean;
  strategy: RuntimeStrategyView;
  provider: string;
  onOpenChange: (open: boolean) => void;
}) => {
  const config = JSON.stringify(strategy.config, null, 2);
  const serviceInfo = [
    { label: 'Strategy revision', value: strategy.strategyRevision },
    { label: 'Config ID', value: strategy.configId },
    { label: 'Runtime key', value: strategy.runtimeKey },
    { label: 'Deployment', value: strategy.deploymentId },
    {
      label: 'Configured tickers',
      value: strategy.selection?.tickers?.length ?? 'All available',
    },
    { label: 'Account label', value: strategy.accountLabel ?? 'Not set' },
    { label: 'Account ID', value: strategy.accountId ?? 'Not assigned' },
    {
      label: 'Policy profile',
      value: strategy.policyProfileId ?? 'Not assigned',
    },
    { label: 'Connector', value: provider },
    { label: 'Universe', value: strategy.universe },
    { label: 'Timeframe', value: `${strategy.interval}m` },
    {
      label: 'Strategy state',
      value: strategy.enabled ? 'Enabled' : 'Disabled',
    },
    { label: 'Control state', value: strategy.controlState },
    {
      label: 'Runtime connection',
      value: strategy.connected ? 'Connected' : 'Disconnected',
    },
    { label: 'Total trades', value: strategy.summary.totalTrades },
    { label: 'Active trades', value: strategy.summary.activeTrades },
    { label: 'Closed trades', value: strategy.summary.closedTrades },
    { label: 'Tracked symbols', value: strategy.symbols.length },
  ];

  return (
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
              <Drawer.Title>{strategy.strategyName} configuration</Drawer.Title>
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
              <Text color="gray.400">
                This configuration is read-only here. Change it in
                tradejs.config.ts and deploy a new Project image.
              </Text>

              <Box
                p={4}
                borderWidth="1px"
                borderColor="gray.800"
                borderRadius="md"
                bg="gray.900"
              >
                <Text
                  mb={3}
                  fontSize="xs"
                  fontWeight="semibold"
                  color="gray.400"
                  textTransform="uppercase"
                  letterSpacing="wide"
                >
                  Runtime details
                </Text>
                <SimpleGrid columns={{ base: 1, sm: 2 }} gapX={6} gapY={4}>
                  {serviceInfo.map((item) => (
                    <Box key={item.label} minW={0}>
                      <Text fontSize="xs" color="gray.500">
                        {item.label}
                      </Text>
                      <Text
                        mt={1}
                        fontFamily="mono"
                        fontSize="sm"
                        color="gray.200"
                        overflowWrap="anywhere"
                      >
                        {item.value}
                      </Text>
                    </Box>
                  ))}
                </SimpleGrid>
                <Box mt={4} pt={4} borderTopWidth="1px" borderColor="gray.800">
                  <Text fontSize="xs" color="gray.500">
                    Configured ticker selection
                  </Text>
                  <Text
                    mt={1}
                    mb={4}
                    fontFamily="mono"
                    fontSize="sm"
                    color="gray.200"
                    overflowWrap="anywhere"
                  >
                    {strategy.selection?.tickers?.length
                      ? strategy.selection.tickers.join(', ')
                      : 'All available tickers'}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    Symbols with trades
                  </Text>
                  <Text
                    mt={1}
                    fontFamily="mono"
                    fontSize="sm"
                    color="gray.200"
                    overflowWrap="anywhere"
                  >
                    {strategy.symbols.length
                      ? strategy.symbols.join(', ')
                      : 'No symbols'}
                  </Text>
                </Box>
              </Box>

              <Clipboard.Root value={config} display="block" w="full">
                <Flex mb={2} alignItems="center" justifyContent="space-between">
                  <Text
                    fontSize="xs"
                    fontWeight="semibold"
                    color="gray.400"
                    textTransform="uppercase"
                    letterSpacing="wide"
                  >
                    Strategy config
                  </Text>
                  <Clipboard.Trigger asChild>
                    <IconButton
                      aria-label="Copy strategy config"
                      title="Copy strategy config"
                      size="xs"
                      variant="ghost"
                    >
                      <Clipboard.Indicator />
                    </IconButton>
                  </Clipboard.Trigger>
                </Flex>
                <Textarea
                  value={config}
                  readOnly
                  minH="45vh"
                  fontFamily="mono"
                  fontSize="sm"
                />
              </Clipboard.Root>
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
