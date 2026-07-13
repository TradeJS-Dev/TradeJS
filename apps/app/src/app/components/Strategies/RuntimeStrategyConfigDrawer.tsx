'use client';

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Box,
  Button,
  Checkbox,
  CloseButton,
  Drawer,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Text,
  Textarea,
} from '@chakra-ui/react';
import type { MarketUniverse, StrategyConfig } from '@tradejs/types';
import type { RuntimeStrategyView } from '#app/lib/runtimeStrategies';
import { toaster } from '#ui';

type AccountOption = {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  isDefault?: boolean;
  universes: MarketUniverse[];
};

type OptionsResponse = {
  strategyNames: string[];
  accounts: AccountOption[];
  intervals: string[];
  error?: string;
};

const RESERVED_FIELDS = new Set([
  'ENABLE',
  'INTERVAL',
  'UNIVERSE',
  'ACCOUNT_ID',
]);

const getParameters = (config: StrategyConfig | null) =>
  Object.fromEntries(
    Object.entries(config ?? {}).filter(([key]) => !RESERVED_FIELDS.has(key)),
  );

const SelectField = ({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) => (
  <Field.Root>
    <Field.Label>{label}</Field.Label>
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {children}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  </Field.Root>
);

export const RuntimeStrategyConfigDrawer = ({
  open,
  strategy,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  strategy?: RuntimeStrategyView | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) => {
  const editing = Boolean(strategy);
  const [options, setOptions] = useState<OptionsResponse>({
    strategyNames: [],
    accounts: [],
    intervals: ['15'],
  });
  const [strategyName, setStrategyName] = useState('');
  const [configId, setConfigId] = useState('config');
  const [interval, setInterval] = useState('15');
  const [universe, setUniverse] = useState<MarketUniverse>('crypto');
  const [accountId, setAccountId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [parameters, setParameters] = useState('{}');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/user/runtime-strategy-configs');
      const payload = (await response.json()) as OptionsResponse;
      if (!response.ok)
        throw new Error(
          payload.error || 'Failed to load configuration options',
        );
      setOptions(payload);
      if (!editing && !strategyName)
        setStrategyName(payload.strategyNames[0] ?? '');
    } catch (error) {
      toaster.error({
        title: 'Failed to load strategy settings',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [editing, strategyName]);

  useEffect(() => {
    if (!open) return;
    if (strategy) {
      setStrategyName(strategy.strategyName);
      setConfigId(strategy.configId);
      setInterval(String(strategy.interval ?? '15'));
      setUniverse(strategy.universe ?? 'crypto');
      setAccountId(String(strategy.config?.ACCOUNT_ID ?? ''));
      setEnabled(strategy.enabled);
      setParameters(JSON.stringify(getParameters(strategy.config), null, 2));
    } else {
      setConfigId('config');
      setInterval('15');
      setUniverse('crypto');
      setAccountId('');
      setEnabled(true);
      setParameters('{}');
    }
    void loadOptions();
  }, [loadOptions, open, strategy]);

  const compatibleAccounts = useMemo(
    () =>
      options.accounts.filter(
        (account) =>
          account.enabled &&
          account.provider === 'bybit' &&
          account.universes.includes(universe),
      ),
    [options.accounts, universe],
  );

  useEffect(() => {
    if (
      accountId &&
      !compatibleAccounts.some((account) => account.id === accountId)
    ) {
      setAccountId('');
    }
  }, [accountId, compatibleAccounts]);

  const save = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(parameters) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Strategy parameters must be a JSON object');
      }
      const response = await fetch('/api/user/runtime-strategy-configs', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          strategyName,
          configId,
          interval,
          universe,
          accountId: accountId || null,
          enabled,
          parameters: parsed,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Save failed');
      toaster.success({
        title: editing ? 'Strategy config updated' : 'Strategy config created',
      });
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toaster.error({
        title: 'Could not save strategy config',
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

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
              <Drawer.Title>
                {editing
                  ? 'Edit strategy configuration'
                  : 'Create strategy configuration'}
              </Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>
            <Drawer.Body display="flex" flexDirection="column" gap={5}>
              <SelectField
                label="Strategy"
                value={strategyName}
                onChange={setStrategyName}
                disabled={editing || loading}
              >
                {options.strategyNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectField>
              <Field.Root>
                <Field.Label>Configuration id</Field.Label>
                <Input
                  value={configId}
                  disabled={editing}
                  onChange={(event) => setConfigId(event.target.value)}
                />
                <Field.HelperText>
                  Redis key suffix, for example config or conservative.
                </Field.HelperText>
              </Field.Root>
              <Flex gap={4} align="start">
                <Box flex="1">
                  <SelectField
                    label="Timeframe"
                    value={interval}
                    onChange={setInterval}
                  >
                    {options.intervals.map((value) => (
                      <option key={value} value={value}>
                        {value}m
                      </option>
                    ))}
                  </SelectField>
                </Box>
                <Box flex="1">
                  <SelectField
                    label="Universe"
                    value={universe}
                    onChange={(value) => setUniverse(value as MarketUniverse)}
                  >
                    <option value="crypto">Crypto</option>
                    <option value="tradfi">TradFi</option>
                  </SelectField>
                </Box>
              </Flex>
              <SelectField
                label="Trading account"
                value={accountId}
                onChange={setAccountId}
              >
                <option value="">Default account for {universe}</option>
                {compatibleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                    {account.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </SelectField>
              <Checkbox.Root
                checked={enabled}
                onCheckedChange={(event) => setEnabled(event.checked === true)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>Enabled</Checkbox.Label>
              </Checkbox.Root>
              <Field.Root flex="1">
                <Field.Label>Strategy parameters (JSON)</Field.Label>
                <Textarea
                  value={parameters}
                  onChange={(event) => setParameters(event.target.value)}
                  minH="300px"
                  fontFamily="mono"
                  fontSize="sm"
                />
                <Field.HelperText>
                  Runtime fields are controlled above and cannot be overridden
                  here.
                </Field.HelperText>
              </Field.Root>
              <Text color="gray.500" fontSize="sm">
                Safety rule: the same strategy cannot be enabled twice for the
                same effective account, even with another timeframe or
                parameters.
              </Text>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                colorPalette="teal"
                loading={saving}
                disabled={loading || !strategyName || !configId.trim()}
                onClick={() => void save()}
              >
                {editing ? 'Save changes' : 'Create'}
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
