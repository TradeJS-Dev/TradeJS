'use client';

import { useActionConfirmation } from '#shared/ActionConfirmation';
import { AuthenticatorCodeField } from '#shared/AuthenticatorCodeField';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Input,
  QrCode,
  Stack,
  Text,
} from '@chakra-ui/react';

const endpoint = '/api/user/two-factor';

type Setup = { key: string; uri: string; setup: string };

export const TwoFactorSettings = () => {
  const confirmAction = useActionConfirmation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [digits, setDigits] = useState<string[]>([]);
  const code = digits.join('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || typeof data?.enabled !== 'boolean')
          throw new Error();
        setEnabled(data.enabled);
      } catch {
        if (!controller.signal.aborted)
          setError('Could not load two-factor settings.');
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const clearForm = () => {
    setSetup(null);
    setDigits([]);
    setError('');
  };

  const submit = async (action: 'start' | 'enable' | 'disable') => {
    setPending(true);
    setError('');
    try {
      const body = { action, code, setup: setup?.setup };
      const response =
        action === 'start'
          ? await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          : await confirmAction(endpoint, {
              title:
                action === 'enable'
                  ? 'Enable two-factor authentication'
                  : 'Disable two-factor authentication',
              method: 'POST',
              body,
              allowRecovery: action === 'disable',
            });
      if (!response) return;
      const data = await response.json();
      if (!response.ok) {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : 'Could not update two-factor settings.',
        );
        return;
      }
      if (
        action === 'start' &&
        typeof data?.key === 'string' &&
        typeof data.uri === 'string' &&
        typeof data.setup === 'string'
      ) {
        setSetup({ key: data.key, uri: data.uri, setup: data.setup });
        return;
      }
      if (
        action === 'enable' &&
        data?.enabled === true &&
        Array.isArray(data.recoveryCodes) &&
        data.recoveryCodes.every((value: unknown) => typeof value === 'string')
      ) {
        setEnabled(true);
        setRecoveryCodes(data.recoveryCodes);
        clearForm();
        return;
      }
      if (action === 'disable' && data?.enabled === false) {
        setEnabled(false);
        setRecoveryCodes([]);
        clearForm();
        return;
      }
      throw new Error();
    } catch {
      setError('Could not update two-factor settings.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="lg"
      p={4}
      bg="bg.panel"
    >
      <Stack gap={4}>
        <Box>
          <Text fontWeight="600">Two-factor authentication</Text>
          <Text fontSize="sm" color="fg.muted">
            {enabled === null
              ? 'Use Google Authenticator to protect sign-in.'
              : enabled
                ? 'Enabled. Sign-in requires a code.'
                : 'Disabled. Set up Google Authenticator to protect sign-in.'}
          </Text>
        </Box>

        {recoveryCodes.length > 0 ? (
          <Stack gap={3}>
            <Text fontSize="sm">
              Save these one-time recovery codes now. They are shown only once.
            </Text>
            <Box as="pre" fontSize="sm" overflowX="auto">
              {recoveryCodes.join('\n')}
            </Box>
            <Flex justify="flex-end">
              <Button onClick={() => setRecoveryCodes([])}>Done</Button>
            </Flex>
          </Stack>
        ) : setup ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending && code.length === 6) void submit('enable');
            }}
          >
            <Stack gap={4}>
              <Stack align="start" gap={3}>
                <Text fontSize="sm" color="fg.muted">
                  In Google Authenticator, tap + and choose Scan a QR code.
                </Text>
                <QrCode.Root
                  value={setup.uri}
                  size="xl"
                  bg="white"
                  color="black"
                  p={6}
                  borderRadius="md"
                >
                  <QrCode.Frame
                    role="img"
                    aria-label="Google Authenticator setup QR code"
                    display="block"
                  >
                    <QrCode.Pattern />
                  </QrCode.Frame>
                </QrCode.Root>
              </Stack>
              <Field.Root>
                <Field.Label>Manual setup key</Field.Label>
                <Input
                  value={setup.key}
                  readOnly
                  fontFamily="mono"
                  onFocus={(event) => event.target.select()}
                />
                <Field.HelperText>
                  Select Time based when entering the key manually.
                </Field.HelperText>
              </Field.Root>
              <AuthenticatorCodeField
                value={digits}
                onChange={setDigits}
                disabled={pending}
              />
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={clearForm} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  colorPalette="teal"
                  loading={pending}
                  disabled={code.length !== 6}
                >
                  Enable
                </Button>
              </Flex>
            </Stack>
          </form>
        ) : enabled !== null ? (
          <Flex justify="flex-end">
            <Button
              onClick={() => void submit(enabled ? 'disable' : 'start')}
              loading={pending}
            >
              {enabled ? 'Disable 2FA' : 'Set up 2FA'}
            </Button>
          </Flex>
        ) : null}

        {error && (
          <Text role="alert" fontSize="sm" color="red.300">
            {error}
          </Text>
        )}
      </Stack>
    </Box>
  );
};
