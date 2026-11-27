'use client';

import { AuthenticatorCodeField } from '#shared/AuthenticatorCodeField';

import {
  Button,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from '@chakra-ui/react';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

type Method = 'password' | 'code';
type Challenge = { method: Method; error: string };
type RequestAction = (
  url: string,
  options: {
    method: 'POST' | 'PATCH' | 'DELETE';
    body?: object;
    title: string;
    allowRecovery?: boolean;
  },
) => Promise<Response | null>;

const ConfirmationContext = createContext<RequestAction | null>(null);

export const useActionConfirmation = () => {
  const request = useContext(ConfirmationContext);
  if (!request) throw new Error('ActionConfirmationProvider is missing');
  return request;
};

const readChallenge = async (response: Response): Promise<Challenge | null> => {
  if (response.status !== 403 && response.status !== 429) return null;
  const data = await response
    .clone()
    .json()
    .catch(() => null);
  const method = data?.confirmation?.method;
  return method === 'password' || method === 'code'
    ? {
        method,
        error:
          typeof data.error === 'string' ? data.error : 'Confirmation failed.',
      }
    : null;
};

type Pending = {
  title: string;
  allowRecovery: boolean;
  send: (proof: { method: Method; value: string }) => Promise<Response>;
  resolve: (response: Response | null) => void;
};

export const ActionConfirmationProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const pending = useRef<Pending | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState<string[]>([]);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      pending.current?.resolve(null);
      pending.current = null;
    };
  }, []);

  const request: RequestAction = async (
    url,
    { method, body, title, allowRecovery = false },
  ) => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || pending.current) return null;
    const send = (proof?: { method: Method; value: string }) =>
      fetch(url, {
        method,
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, confirmation: proof }),
      });
    const response = await send();
    const required = await readChallenge(response);
    if (!required) return response;
    if (signal.aborted || pending.current) return null;

    return new Promise((resolve) => {
      pending.current = { title, allowRecovery, send, resolve };
      setChallenge(required);
    });
  };

  const clearInput = () => {
    setPassword('');
    setDigits([]);
    setRecoveryCode(null);
  };

  const value =
    challenge?.method === 'password'
      ? password
      : recoveryCode ?? digits.join('');
  const complete =
    challenge?.method === 'password'
      ? Boolean(password)
      : recoveryCode === null
        ? value.length === 6
        : Boolean(recoveryCode.trim());

  const close = (response: Response | null) => {
    const action = pending.current;
    pending.current = null;
    setChallenge(null);
    clearInput();
    action?.resolve(response);
  };

  const submit = async () => {
    const action = pending.current;
    if (!challenge || !action || saving || !complete) return;
    setSaving(true);
    try {
      const response = await action.send({ method: challenge.method, value });
      const retry = await readChallenge(response);
      if (pending.current !== action) return;
      if (retry) {
        setChallenge(retry);
        setPassword('');
        setDigits([]);
        setRecoveryCode((current) =>
          retry.method === 'code' && current !== null ? '' : null,
        );
      } else {
        close(response);
      }
    } catch {
      if (pending.current === action) {
        setChallenge({
          method: challenge.method,
          error: 'Could not confirm. Try again.',
        });
        setPassword('');
        setDigits([]);
        setRecoveryCode((current) => (current === null ? null : ''));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmationContext.Provider value={request}>
      {children}
      <Dialog.Root
        open={Boolean(challenge)}
        initialFocusEl={() => field.current}
        closeOnEscape={!saving}
        closeOnInteractOutside={false}
        onOpenChange={({ open }) => {
          if (!open && !saving) close(null);
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <Dialog.Header>
                  <Dialog.Title>{pending.current?.title}</Dialog.Title>
                </Dialog.Header>
                <Dialog.Body>
                  <Stack gap={3}>
                    {challenge?.method === 'password' ? (
                      <Field.Root>
                        <Field.Label>Current password</Field.Label>
                        <Input
                          ref={field}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          type="password"
                          autoComplete="current-password"
                          disabled={saving}
                        />
                      </Field.Root>
                    ) : challenge?.method === 'code' ? (
                      <AuthenticatorCodeField
                        value={digits}
                        onChange={setDigits}
                        disabled={saving}
                        inputRef={field}
                        recovery={
                          pending.current?.allowRecovery
                            ? { value: recoveryCode, onChange: setRecoveryCode }
                            : undefined
                        }
                      />
                    ) : null}
                    {challenge && (
                      <Text role="status" fontSize="sm">
                        {challenge.error}
                      </Text>
                    )}
                  </Stack>
                </Dialog.Body>
                <Dialog.Footer>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => close(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    colorPalette="teal"
                    loading={saving}
                    disabled={!complete}
                  >
                    Confirm
                  </Button>
                </Dialog.Footer>
              </form>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </ConfirmationContext.Provider>
  );
};
