'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Menu,
  Portal,
  SimpleGrid,
  Stat,
  Text,
} from '@chakra-ui/react';
import { getFormatted } from '@tradejs/core/backtest';
import type { RuntimeStrategyView, TestThresholdsKey } from '@tradejs/types';
import {
  formatDateTime,
  OrdersDrawerPanel,
} from '#components/Shared/OrdersDrawer';
import { RuntimeStrategyChart } from './RuntimeStrategyChart';
import { RuntimeStrategyConfigDrawer } from './RuntimeStrategyConfigDrawer';
import { RuntimeStrategyRevisionsDrawer } from './RuntimeStrategyRevisionsDrawer';
import { RuntimeStrategyStatsDrawer } from './RuntimeStrategyStatsDrawer';
import {
  buildRuntimeStrategyCardViewModel,
  getColorByLevel,
  RUNTIME_ORDER_ROW_HEIGHT,
} from './RuntimeStrategyCard.presenter';
import { toaster } from '#ui';

const StatItem = ({
  stat,
  id,
  title,
}: {
  stat: RuntimeStrategyView['stat'];
  id: TestThresholdsKey;
  title: string;
}) => {
  const { formatted, level } = getFormatted(stat, id);

  return (
    <Stat.Root size="md">
      <Stat.Label>{title}</Stat.Label>
      <Stat.ValueText color={getColorByLevel(level)}>
        {formatted}
      </Stat.ValueText>
    </Stat.Root>
  );
};

export const RuntimeStrategyCard = ({
  strategy,
  provider,
  startTimestamp,
  endTimestamp,
  onUpdated,
}: {
  strategy: RuntimeStrategyView;
  provider: string;
  startTimestamp: number;
  endTimestamp: number;
  onUpdated: () => Promise<void> | void;
}) => {
  const [configOpen, setConfigOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [controlSaving, setControlSaving] = useState(false);
  const viewModel = useMemo(
    () => buildRuntimeStrategyCardViewModel(strategy),
    [strategy],
  );
  const { lastTrade, runtimeOrders } = viewModel;
  const setControlState = async (controlState: 'active' | 'entries_paused') => {
    setControlSaving(true);
    try {
      const response = await fetch(
        `/api/user/runtime-deployments/${encodeURIComponent(strategy.deploymentId)}/strategies/${encodeURIComponent(strategy.strategyName)}/control`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ controlState }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Update failed');
      toaster.success({
        title:
          controlState === 'entries_paused'
            ? 'New entries paused'
            : 'Strategy resumed',
      });
      await onUpdated();
    } catch (error) {
      toaster.error({
        title: 'Could not update strategy state',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setControlSaving(false);
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
      borderColor={strategy.connected ? 'gray.800' : 'orange.900'}
      overflowX="auto"
    >
      <Flex gap="4" p={4} mb={3} alignItems="center" wrap="wrap">
        <Text fontSize="lg" fontWeight="bold" color="gray.200">
          {strategy.strategyName}
        </Text>
        <Badge
          colorPalette={strategy.enabled ? 'teal' : 'gray'}
          variant="subtle"
          fontFamily="mono"
          letterSpacing="0"
        >
          {strategy.controlState === 'entries_paused'
            ? 'entries paused'
            : strategy.enabled
              ? 'enabled'
              : 'disabled'}
        </Badge>
        <Badge colorPalette="blue" variant="outline">
          {strategy.universe}
        </Badge>
        <Badge colorPalette="cyan" variant="outline">
          TF: {strategy.interval}m
        </Badge>
        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            connector:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {provider}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            trades:
          </Text>
          <Text fontSize="lg" fontWeight="bold" color="gray.200">
            {strategy.summary.totalTrades}
          </Text>
        </Flex>

        <Flex gap="1">
          <Text fontSize="sm" fontWeight="bold" color="gray.400" mt={1}>
            active:
          </Text>
          <Text
            fontSize="lg"
            fontWeight="bold"
            color={
              strategy.summary.activeTrades > 0 ? 'orange.300' : 'gray.200'
            }
          >
            {strategy.summary.activeTrades}
          </Text>
        </Flex>

        <Flex ml="auto" gap={3} alignItems="center">
          <Text fontSize="sm" color="gray.500">
            {lastTrade
              ? `last trade: ${lastTrade.symbol} ${formatDateTime(lastTrade.entryTimestamp)}`
              : strategy.connected
                ? 'connected, no runtime trades yet'
                : 'runtime trades only'}
          </Text>

          <Menu.Root positioning={{ placement: 'bottom-end' }}>
            <Menu.Trigger asChild>
              <Button size="sm" variant="outline">
                Actions
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content minW="160px">
                  <Menu.Item value="config" onClick={() => setConfigOpen(true)}>
                    View config
                  </Menu.Item>
                  <Menu.Item
                    value="control"
                    disabled={controlSaving}
                    onClick={() =>
                      void setControlState(
                        strategy.controlState === 'entries_paused'
                          ? 'active'
                          : 'entries_paused',
                      )
                    }
                  >
                    {strategy.controlState === 'entries_paused'
                      ? 'Resume entries'
                      : 'Pause new entries'}
                  </Menu.Item>
                  <Menu.Item value="orders" onClick={() => setOrdersOpen(true)}>
                    Orders
                  </Menu.Item>
                  <Menu.Item value="stat" onClick={() => setStatsOpen(true)}>
                    Stat
                  </Menu.Item>
                  <Menu.Item
                    value="revisions"
                    onClick={() => setRevisionsOpen(true)}
                  >
                    Revisions
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
      </Flex>

      <OrdersDrawerPanel
        title={`${strategy.strategyName} orders`}
        open={ordersOpen}
        orders={runtimeOrders}
        rowHeight={RUNTIME_ORDER_ROW_HEIGHT}
        onOpenChange={setOrdersOpen}
      />

      <RuntimeStrategyConfigDrawer
        open={configOpen}
        strategy={strategy}
        provider={provider}
        onOpenChange={setConfigOpen}
      />

      <RuntimeStrategyStatsDrawer
        strategy={strategy}
        provider={provider}
        open={statsOpen}
        onOpenChange={setStatsOpen}
        viewModel={viewModel}
      />

      <RuntimeStrategyRevisionsDrawer
        open={revisionsOpen}
        strategy={strategy}
        onOpenChange={setRevisionsOpen}
      />

      <RuntimeStrategyChart
        orderLog={strategy.orderLog}
        revisionChanges={strategy.revisionChanges}
        stat={strategy.stat}
        startTimestamp={startTimestamp}
        endTimestamp={endTimestamp}
      />

      <SimpleGrid columns={{ base: 4, md: 8 }} p={4}>
        <StatItem stat={strategy.stat} id="netProfit" title="P&L" />
        <StatItem stat={strategy.stat} id="minAmount" title="Min Amount" />
        <StatItem stat={strategy.stat} id="maxDrawdown" title="Drawdown" />
        <StatItem stat={strategy.stat} id="orders" title="Orders" />
        <StatItem stat={strategy.stat} id="winRate" title="Win Rate" />
        <StatItem
          stat={strategy.stat}
          id="riskRewardRatio"
          title="Risk Ratio"
        />
        <StatItem
          stat={strategy.stat}
          id="maxConsecutiveWins"
          title="Max Gross Streak"
        />
        <StatItem
          stat={strategy.stat}
          id="maxConsecutiveLosses"
          title="Max Loss Streak"
        />
      </SimpleGrid>
    </Box>
  );
};
