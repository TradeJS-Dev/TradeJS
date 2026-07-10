'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Field, Flex, Input, Stack, Text } from '@chakra-ui/react';
import type {
  MarketUniverse,
  RuntimeDeployment,
  RuntimeDeploymentHeartbeat,
} from '@tradejs/types';
import { toaster } from '#ui';

type PublicTradingAccount = {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  isDefault?: boolean;
  universes: MarketUniverse[];
  environment: 'mainnet' | 'testnet';
  hasApiKey: boolean;
  hasApiSecret: boolean;
};
type RuntimeDeploymentView = RuntimeDeployment & {
  heartbeat?: RuntimeDeploymentHeartbeat | null;
};

export const getDeploymentProcessStatus = (
  deployment: RuntimeDeploymentView,
) => {
  const heartbeat = deployment.heartbeat;
  if (!heartbeat) return 'not started';
  const staleAfterMs = Math.max(
    5 * 60_000,
    Number(deployment.interval || 15) * 60_000 * 2,
  );
  if (
    heartbeat.status === 'running' &&
    Date.now() - heartbeat.lastCycleAt > staleAfterMs
  ) {
    return 'stale';
  }
  return heartbeat.status;
};

const FieldInput = ({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) => (
  <Field.Root>
    <Field.Label>{label}</Field.Label>
    <Input
      value={value}
      type={type}
      onChange={(event) => onChange(event.target.value)}
    />
  </Field.Root>
);

export const TradingAccountsPanel = () => {
  const [accounts, setAccounts] = useState<PublicTradingAccount[]>([]);
  const [deployments, setDeployments] = useState<RuntimeDeploymentView[]>([]);
  const [saving, setSaving] = useState(false);
  const [accountDraft, setAccountDraft] = useState({
    id: '',
    label: '',
    apiKey: '',
    apiSecret: '',
    universe: 'crypto' as MarketUniverse,
    isDefault: false,
  });
  const [deploymentDraft, setDeploymentDraft] = useState({
    id: '',
    label: '',
    accountId: '',
    universe: 'crypto' as MarketUniverse,
    interval: '15',
    strategyName: '',
    policyProfileId: 'crypto',
    tickers: '',
  });

  const load = useCallback(async () => {
    const [accountsResponse, deploymentsResponse] = await Promise.all([
      fetch('/api/user/trading-accounts'),
      fetch('/api/user/runtime-deployments'),
    ]);
    if (accountsResponse.ok) {
      const payload = (await accountsResponse.json()) as {
        accounts?: PublicTradingAccount[];
      };
      setAccounts(payload.accounts ?? []);
    }
    if (deploymentsResponse.ok) {
      const payload = (await deploymentsResponse.json()) as {
        deployments?: RuntimeDeploymentView[];
      };
      setDeployments(payload.deployments ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAccount = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/user/trading-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...accountDraft,
          provider: 'bybit',
          enabled: true,
          universes: [accountDraft.universe],
          environment: 'mainnet',
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Save failed');
      setAccountDraft({
        id: '',
        label: '',
        apiKey: '',
        apiSecret: '',
        universe: 'crypto',
        isDefault: false,
      });
      await load();
      toaster.create({ title: 'Trading account saved', type: 'success' });
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : 'Save failed',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const saveDeployment = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/user/runtime-deployments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: deploymentDraft.id,
          label: deploymentDraft.label,
          connectorName: 'bybit',
          provider: 'bybit',
          accountId: deploymentDraft.accountId,
          universe: deploymentDraft.universe,
          interval: deploymentDraft.interval,
          enabled: true,
          tickers: deploymentDraft.tickers
            .split(',')
            .map((ticker) => ticker.trim().toUpperCase())
            .filter(Boolean),
          strategies: [
            {
              strategyName: deploymentDraft.strategyName,
              policyProfileId: deploymentDraft.policyProfileId,
              enabled: true,
            },
          ],
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Save failed');
      await load();
      toaster.create({ title: 'Runtime deployment saved', type: 'success' });
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : 'Save failed',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box borderWidth="1px" borderColor="gray.700" borderRadius="lg" p={4}>
      <Stack gap={5}>
        <Box>
          <Text fontWeight="600">Trading accounts & deployments</Text>
          <Text fontSize="sm" color="gray.400">
            Credentials belong to accounts. A deployment binds one account,
            universe, interval and strategy policy for a signals process.
          </Text>
        </Box>

        <Stack gap={2}>
          {accounts.map((account) => (
            <Flex
              key={account.id}
              justify="space-between"
              borderWidth="1px"
              borderColor="gray.700"
              borderRadius="md"
              p={3}
            >
              <Box>
                <Text fontWeight="600">{account.label}</Text>
                <Text fontSize="xs" color="gray.400">
                  {account.id} · {account.provider} ·{' '}
                  {account.universes.join(', ')} · {account.environment}
                </Text>
              </Box>
              <Text
                fontSize="xs"
                color={account.enabled ? 'green.300' : 'red.300'}
              >
                {account.enabled ? 'enabled' : 'disabled'}
              </Text>
            </Flex>
          ))}
        </Stack>

        <Stack gap={3}>
          <Text fontSize="sm" fontWeight="600">
            Add or rotate Bybit account
          </Text>
          <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
            <FieldInput
              label="Account id"
              value={accountDraft.id}
              onChange={(id) => setAccountDraft((draft) => ({ ...draft, id }))}
            />
            <FieldInput
              label="Label"
              value={accountDraft.label}
              onChange={(label) =>
                setAccountDraft((draft) => ({ ...draft, label }))
              }
            />
          </Flex>
          <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
            <FieldInput
              label="API key"
              value={accountDraft.apiKey}
              onChange={(apiKey) =>
                setAccountDraft((draft) => ({ ...draft, apiKey }))
              }
            />
            <FieldInput
              label="API secret"
              type="password"
              value={accountDraft.apiSecret}
              onChange={(apiSecret) =>
                setAccountDraft((draft) => ({ ...draft, apiSecret }))
              }
            />
          </Flex>
          <Field.Root>
            <Field.Label>Universe</Field.Label>
            <select
              value={accountDraft.universe}
              onChange={(event) =>
                setAccountDraft((draft) => ({
                  ...draft,
                  universe: event.target.value as MarketUniverse,
                }))
              }
            >
              <option value="crypto">Crypto</option>
              <option value="tradfi">TradFi</option>
            </select>
          </Field.Root>
          <label>
            <input
              type="checkbox"
              checked={accountDraft.isDefault}
              onChange={(event) =>
                setAccountDraft((draft) => ({
                  ...draft,
                  isDefault: event.target.checked,
                }))
              }
            />{' '}
            Use as default Bybit account
          </label>
          <Button colorPalette="teal" loading={saving} onClick={saveAccount}>
            Save account
          </Button>
        </Stack>

        <Stack gap={2}>
          {deployments.map((deployment) => (
            <Box
              key={deployment.id}
              borderWidth="1px"
              borderColor="gray.700"
              borderRadius="md"
              p={3}
            >
              <Text fontWeight="600">{deployment.label}</Text>
              <Text fontSize="xs" color="gray.400">
                {deployment.id} · account {deployment.accountId} ·{' '}
                {deployment.universe} · {deployment.interval}m ·{' '}
                {deployment.strategies
                  .map(
                    (strategy) =>
                      `${strategy.strategyName}:${strategy.policyProfileId}`,
                  )
                  .join(', ')}
              </Text>
              <Text mt={2} fontSize="xs" color="gray.500">
                yarn signals:daemon --deployment {deployment.id} --timeframe{' '}
                {deployment.interval}
              </Text>
              <Text
                mt={1}
                fontSize="xs"
                color={
                  getDeploymentProcessStatus(deployment) === 'running'
                    ? 'green.300'
                    : getDeploymentProcessStatus(deployment) === 'error' ||
                        getDeploymentProcessStatus(deployment) === 'stale'
                      ? 'red.300'
                      : 'gray.500'
                }
              >
                process: {getDeploymentProcessStatus(deployment)}
                {deployment.heartbeat?.lastCycleAt
                  ? ` · ${new Date(deployment.heartbeat.lastCycleAt).toLocaleString()}`
                  : ''}
              </Text>
            </Box>
          ))}
        </Stack>

        <Stack gap={3}>
          <Text fontSize="sm" fontWeight="600">
            Create deployment
          </Text>
          <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
            <FieldInput
              label="Deployment id"
              value={deploymentDraft.id}
              onChange={(id) =>
                setDeploymentDraft((draft) => ({ ...draft, id }))
              }
            />
            <FieldInput
              label="Label"
              value={deploymentDraft.label}
              onChange={(label) =>
                setDeploymentDraft((draft) => ({ ...draft, label }))
              }
            />
          </Flex>
          <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
            <FieldInput
              label="Account id"
              value={deploymentDraft.accountId}
              onChange={(accountId) =>
                setDeploymentDraft((draft) => ({ ...draft, accountId }))
              }
            />
            <FieldInput
              label="Strategy"
              value={deploymentDraft.strategyName}
              onChange={(strategyName) =>
                setDeploymentDraft((draft) => ({ ...draft, strategyName }))
              }
            />
            <FieldInput
              label="Policy profile"
              value={deploymentDraft.policyProfileId}
              onChange={(policyProfileId) =>
                setDeploymentDraft((draft) => ({
                  ...draft,
                  policyProfileId,
                }))
              }
            />
          </Flex>
          <Flex gap={3} direction={{ base: 'column', md: 'row' }}>
            <Field.Root>
              <Field.Label>Universe</Field.Label>
              <select
                value={deploymentDraft.universe}
                onChange={(event) =>
                  setDeploymentDraft((draft) => ({
                    ...draft,
                    universe: event.target.value as MarketUniverse,
                  }))
                }
              >
                <option value="crypto">Crypto</option>
                <option value="tradfi">TradFi</option>
              </select>
            </Field.Root>
            <FieldInput
              label="Interval"
              value={deploymentDraft.interval}
              onChange={(interval) =>
                setDeploymentDraft((draft) => ({ ...draft, interval }))
              }
            />
            <FieldInput
              label="Tickers (comma separated)"
              value={deploymentDraft.tickers}
              onChange={(tickers) =>
                setDeploymentDraft((draft) => ({ ...draft, tickers }))
              }
            />
          </Flex>
          <Button
            colorPalette="teal"
            variant="outline"
            loading={saving}
            onClick={saveDeployment}
          >
            Save deployment
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};
