'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  HStack,
  IconButton,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiEdit2 } from 'react-icons/fi';
import type { MarketUniverse } from '@tradejs/types';
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
  maskedApiKey: string;
  maskedApiSecret: string;
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

type CredentialFieldName = 'apiKey' | 'apiSecret';

const AccountCredentialField = ({
  label,
  savedValue,
  value,
  editing,
  onEdit,
  onChange,
}: {
  label: string;
  savedValue: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onChange: (value: string) => void;
}) => (
  <Field.Root width="full">
    <Field.Label>{label}</Field.Label>
    <HStack align="stretch" width="full">
      {editing ? (
        <Input
          flex="1"
          minW="0"
          type="password"
          value={value}
          placeholder={`Enter a new ${label}`}
          onChange={(event) => onChange(event.target.value)}
          autoFocus
          fontFamily="mono"
        />
      ) : (
        <Flex
          flex="1"
          minW="0"
          h="10"
          px="3"
          borderWidth="1px"
          borderColor="whiteAlpha.200"
          borderRadius="md"
          bg="blackAlpha.300"
          align="center"
          color={savedValue ? 'gray.200' : 'gray.500'}
          cursor="default"
          userSelect="none"
        >
          <Text
            width="full"
            overflow="hidden"
            whiteSpace="nowrap"
            textOverflow="ellipsis"
            fontFamily={savedValue ? 'mono' : undefined}
          >
            {savedValue || 'Not set'}
          </Text>
        </Flex>
      )}
      <IconButton
        aria-label={`Edit ${label}`}
        size="md"
        colorPalette="teal"
        variant={editing ? 'solid' : 'outline'}
        flexShrink={0}
        onClick={onEdit}
      >
        <FiEdit2 />
      </IconButton>
    </HStack>
  </Field.Root>
);

export const TradingAccountsPanel = () => {
  const [accounts, setAccounts] = useState<PublicTradingAccount[]>([]);
  const [saving, setSaving] = useState<'account' | 'default' | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState('');
  const [accountDraft, setAccountDraft] = useState({
    id: '',
    label: '',
    apiKey: '',
    apiSecret: '',
  });
  const [addingAccount, setAddingAccount] = useState(false);
  const [editingCredentials, setEditingCredentials] = useState<
    Record<CredentialFieldName, boolean>
  >({ apiKey: false, apiSecret: false });

  const load = useCallback(async () => {
    const accountsResponse = await fetch('/api/user/trading-accounts');
    if (accountsResponse.ok) {
      const payload = (await accountsResponse.json()) as {
        accounts?: PublicTradingAccount[];
      };
      const nextAccounts = payload.accounts ?? [];
      setAccounts(nextAccounts);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAccount = async () => {
    setSaving('account');
    try {
      const normalizedLabel = accountDraft.label.trim();
      const baseId =
        normalizedLabel
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'account';
      const generatedId = `bybit-${baseId}`;
      const id =
        accountDraft.id ||
        (accounts.some((account) => account.id === generatedId)
          ? `${generatedId}-${Date.now().toString(36)}`
          : generatedId);
      const response = await fetch('/api/user/trading-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...accountDraft,
          id,
          provider: 'bybit',
          enabled: true,
          universes: ['crypto', 'tradfi'],
          environment: 'mainnet',
          isDefault:
            accounts.length === 0 ||
            accounts.find((account) => account.id === id)?.isDefault === true,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Save failed');
      setAccountDraft({
        id: '',
        label: '',
        apiKey: '',
        apiSecret: '',
      });
      setAddingAccount(false);
      setEditingCredentials({ apiKey: false, apiSecret: false });
      await load();
      toaster.create({ title: 'Trading account saved', type: 'success' });
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : 'Save failed',
        type: 'error',
      });
    } finally {
      setSaving(null);
    }
  };

  const editCredential = (
    account: PublicTradingAccount,
    field: CredentialFieldName,
  ) => {
    if (accountDraft.id !== account.id) {
      setAccountDraft({
        id: account.id,
        label: account.label,
        apiKey: '',
        apiSecret: '',
      });
      setEditingCredentials({
        apiKey: field === 'apiKey',
        apiSecret: field === 'apiSecret',
      });
      return;
    }
    setEditingCredentials((current) => ({ ...current, [field]: true }));
  };

  const makeDefault = async (account: PublicTradingAccount) => {
    setSaving('default');
    setSettingDefaultId(account.id);
    try {
      const response = await fetch('/api/user/trading-accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: account.id,
          label: account.label,
          provider: account.provider,
          enabled: account.enabled,
          universes: account.universes,
          environment: account.environment,
          isDefault: true,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Save failed');
      await load();
      toaster.create({
        title: 'Default trading account updated',
        type: 'success',
      });
    } catch (error) {
      toaster.create({
        title: error instanceof Error ? error.message : 'Save failed',
        type: 'error',
      });
    } finally {
      setSaving(null);
      setSettingDefaultId('');
    }
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="gray.700"
      borderRadius="lg"
      p={4}
      bg="gray.900"
    >
      <Stack gap={4}>
        <Box>
          <Text fontWeight="600">Bybit</Text>
          <Text fontSize="sm" color="gray.400">
            Trading account credentials used by active strategies.
          </Text>
        </Box>

        {accounts.map((account) => {
          const isEditingAccount = accountDraft.id === account.id;
          const hasChanges = Boolean(
            isEditingAccount &&
              (accountDraft.apiKey.trim() || accountDraft.apiSecret.trim()),
          );
          return (
            <Stack
              key={account.id}
              borderWidth={accounts.length > 1 ? '1px' : '0'}
              borderColor="gray.700"
              borderRadius="md"
              p={accounts.length > 1 ? 3 : 0}
              gap={3}
            >
              <Flex justify="space-between" align="center" gap={3}>
                <Box>
                  <Text fontWeight="600">{account.label}</Text>
                  <Text fontSize="xs" color="gray.400">
                    Bybit · {account.universes.join(' · ')} ·{' '}
                    {account.environment}
                  </Text>
                </Box>
                <Flex align="center" gap={2}>
                  <Text
                    fontSize="xs"
                    color={account.enabled ? 'green.300' : 'red.300'}
                  >
                    {account.isDefault
                      ? 'default'
                      : account.enabled
                        ? 'enabled'
                        : 'disabled'}
                  </Text>
                  {!account.isDefault && account.enabled && (
                    <Button
                      size="xs"
                      variant="outline"
                      colorPalette="teal"
                      loading={
                        saving === 'default' && settingDefaultId === account.id
                      }
                      onClick={() => makeDefault(account)}
                    >
                      Make default
                    </Button>
                  )}
                </Flex>
              </Flex>
              <AccountCredentialField
                label="BYBIT_API_KEY"
                savedValue={account.maskedApiKey}
                value={isEditingAccount ? accountDraft.apiKey : ''}
                editing={isEditingAccount && editingCredentials.apiKey}
                onEdit={() => editCredential(account, 'apiKey')}
                onChange={(apiKey) =>
                  setAccountDraft((draft) => ({ ...draft, apiKey }))
                }
              />
              <AccountCredentialField
                label="BYBIT_API_SECRET"
                savedValue={account.maskedApiSecret}
                value={isEditingAccount ? accountDraft.apiSecret : ''}
                editing={isEditingAccount && editingCredentials.apiSecret}
                onEdit={() => editCredential(account, 'apiSecret')}
                onChange={(apiSecret) =>
                  setAccountDraft((draft) => ({ ...draft, apiSecret }))
                }
              />
              <Flex justify="flex-end">
                <Button
                  colorPalette="teal"
                  loading={saving === 'account' && isEditingAccount}
                  disabled={!hasChanges}
                  onClick={saveAccount}
                >
                  Save
                </Button>
              </Flex>
            </Stack>
          );
        })}

        {(accounts.length === 0 || addingAccount) && (
          <Stack gap={3}>
            <Text fontSize="sm" fontWeight="600">
              Connect account
            </Text>
            <FieldInput
              label="Account name"
              value={accountDraft.label}
              onChange={(label) =>
                setAccountDraft((draft) => ({ ...draft, label }))
              }
            />
            <FieldInput
              label="BYBIT_API_KEY"
              type="password"
              value={accountDraft.apiKey}
              onChange={(apiKey) =>
                setAccountDraft((draft) => ({ ...draft, apiKey }))
              }
            />
            <FieldInput
              label="BYBIT_API_SECRET"
              type="password"
              value={accountDraft.apiSecret}
              onChange={(apiSecret) =>
                setAccountDraft((draft) => ({ ...draft, apiSecret }))
              }
            />
            <Flex justify="flex-end" gap={2}>
              {accounts.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAddingAccount(false);
                    setAccountDraft({
                      id: '',
                      label: '',
                      apiKey: '',
                      apiSecret: '',
                    });
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                colorPalette="teal"
                loading={saving === 'account'}
                disabled={
                  !accountDraft.label.trim() ||
                  !accountDraft.apiKey.trim() ||
                  !accountDraft.apiSecret.trim()
                }
                onClick={saveAccount}
              >
                Connect
              </Button>
            </Flex>
          </Stack>
        )}

        {accounts.length > 0 && !addingAccount && (
          <Button
            alignSelf="flex-start"
            size="sm"
            variant="outline"
            colorPalette="teal"
            onClick={() => {
              setAccountDraft({
                id: '',
                label: '',
                apiKey: '',
                apiSecret: '',
              });
              setEditingCredentials({ apiKey: false, apiSecret: false });
              setAddingAccount(true);
            }}
          >
            Add another account
          </Button>
        )}
      </Stack>
    </Box>
  );
};
