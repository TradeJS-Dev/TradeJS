'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CloseButton,
  Drawer,
  Field,
  Flex,
  HStack,
  IconButton,
  Input,
  Portal,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiEdit2, FiSettings } from 'react-icons/fi';
import { toaster } from '@UI';

type SettingsResponse = {
  userName: string;
  settings: {
    bybit: {
      apiKey: string;
      apiSecret: string;
    };
    token: string;
    coinalyze: {
      apiKey: string;
    };
    openai: {
      apiKey: string;
      apiEndpoint: string;
    };
    telegram: {
      botToken: string;
      chatId: string;
    };
  };
};

type SettingsErrorResponse = {
  error?: string;
};

type SettingsViewState = {
  userName: string;
  bybitApiKey: string;
  bybitApiSecret: string;
  token: string;
  coinalyzeApiKey: string;
  openAIApiKey: string;
  openAIApiEndpoint: string;
  tgBotToken: string;
  tgChatId: string;
};

type SettingsDraftState = Omit<SettingsViewState, 'userName'>;

type PasswordState = {
  password: string;
  confirmPassword: string;
};

type SectionName =
  | 'bybit'
  | 'password'
  | 'token'
  | 'coinalyze'
  | 'openai'
  | 'telegram';
type EditableField =
  | 'bybitApiKey'
  | 'bybitApiSecret'
  | 'token'
  | 'coinalyzeApiKey'
  | 'openAIApiKey'
  | 'openAIApiEndpoint'
  | 'tgBotToken'
  | 'tgChatId';

const EMPTY_SETTINGS: SettingsViewState = {
  userName: '',
  bybitApiKey: '',
  bybitApiSecret: '',
  token: '',
  coinalyzeApiKey: '',
  openAIApiKey: '',
  openAIApiEndpoint: '',
  tgBotToken: '',
  tgChatId: '',
};

const EMPTY_DRAFTS: SettingsDraftState = {
  bybitApiKey: '',
  bybitApiSecret: '',
  token: '',
  coinalyzeApiKey: '',
  openAIApiKey: '',
  openAIApiEndpoint: '',
  tgBotToken: '',
  tgChatId: '',
};

const EMPTY_PASSWORDS: PasswordState = {
  password: '',
  confirmPassword: '',
};

const EMPTY_EDITING: Record<EditableField, boolean> = {
  bybitApiKey: false,
  bybitApiSecret: false,
  token: false,
  coinalyzeApiKey: false,
  openAIApiKey: false,
  openAIApiEndpoint: false,
  tgBotToken: false,
  tgChatId: false,
};

const SECTION_FIELDS: Record<
  Exclude<SectionName, 'password'>,
  EditableField[]
> = {
  bybit: ['bybitApiKey', 'bybitApiSecret'],
  token: ['token'],
  coinalyze: ['coinalyzeApiKey'],
  openai: ['openAIApiKey', 'openAIApiEndpoint'],
  telegram: ['tgBotToken', 'tgChatId'],
};

const MASKED_FIELDS = new Set<EditableField>([
  'bybitApiKey',
  'bybitApiSecret',
  'token',
  'coinalyzeApiKey',
  'openAIApiKey',
  'tgBotToken',
]);

const toViewState = (payload: SettingsResponse): SettingsViewState => ({
  userName: payload.userName,
  bybitApiKey: payload.settings.bybit.apiKey || '',
  bybitApiSecret: payload.settings.bybit.apiSecret || '',
  token: payload.settings.token || '',
  coinalyzeApiKey: payload.settings.coinalyze.apiKey || '',
  openAIApiKey: payload.settings.openai.apiKey || '',
  openAIApiEndpoint: payload.settings.openai.apiEndpoint || '',
  tgBotToken: payload.settings.telegram.botToken || '',
  tgChatId: payload.settings.telegram.chatId || '',
});

const toDraftState = (view: SettingsViewState): SettingsDraftState => ({
  ...EMPTY_DRAFTS,
  openAIApiEndpoint: view.openAIApiEndpoint,
  tgChatId: view.tgChatId,
});

const isSettingsResponse = (
  payload: SettingsResponse | SettingsErrorResponse,
): payload is SettingsResponse =>
  Boolean(payload && typeof payload === 'object' && 'settings' in payload);

const getErrorMessage = (
  payload: SettingsResponse | SettingsErrorResponse,
  fallback: string,
) =>
  'error' in payload && typeof payload.error === 'string' && payload.error
    ? payload.error
    : fallback;

export const AccountSettingsDrawer = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<SettingsViewState>(EMPTY_SETTINGS);
  const [drafts, setDrafts] = useState<SettingsDraftState>(EMPTY_DRAFTS);
  const [passwords, setPasswords] = useState<PasswordState>(EMPTY_PASSWORDS);
  const [editing, setEditing] =
    useState<Record<EditableField, boolean>>(EMPTY_EDITING);
  const [savingSection, setSavingSection] = useState<SectionName | null>(null);

  const syncState = useCallback((payload: SettingsResponse) => {
    const next = toViewState(payload);
    setSettings(next);
    setDrafts(toDraftState(next));
    setEditing(EMPTY_EDITING);
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/user/settings', {
        cache: 'no-store',
      });
      const payload = (await response.json()) as
        | SettingsResponse
        | SettingsErrorResponse;

      if (!response.ok || !isSettingsResponse(payload)) {
        throw new Error(
          getErrorMessage(payload, 'Failed to load account settings'),
        );
      }

      syncState(payload);
    } catch (error) {
      toaster.error({
        title: 'Failed to load settings',
        description: (error as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [syncState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadSettings();
  }, [open, loadSettings]);

  const passwordError = useMemo(() => {
    if (!passwords.password && !passwords.confirmPassword) {
      return '';
    }

    if (!passwords.password) {
      return 'Password is required';
    }

    if (passwords.password !== passwords.confirmPassword) {
      return 'Passwords do not match';
    }

    return '';
  }, [passwords.confirmPassword, passwords.password]);

  const isSectionDirty = useCallback(
    (section: SectionName) => {
      if (section === 'password') {
        return Boolean(passwords.password || passwords.confirmPassword);
      }

      if (section === 'openai') {
        return (
          Boolean(drafts.openAIApiKey.trim()) ||
          drafts.openAIApiEndpoint !== settings.openAIApiEndpoint
        );
      }

      if (section === 'coinalyze') {
        return Boolean(drafts.coinalyzeApiKey.trim());
      }

      if (section === 'telegram') {
        return (
          Boolean(drafts.tgBotToken.trim()) ||
          drafts.tgChatId !== settings.tgChatId
        );
      }

      return SECTION_FIELDS[section].some((field) =>
        Boolean(drafts[field].trim()),
      );
    },
    [drafts, passwords.confirmPassword, passwords.password, settings],
  );

  const updateDraft = (field: EditableField, value: string) => {
    setDrafts((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetFieldDraft = useCallback(
    (field: EditableField) => {
      setDrafts((current) => ({
        ...current,
        [field]: MASKED_FIELDS.has(field) ? '' : settings[field],
      }));
    },
    [settings],
  );

  const cancelEditing = useCallback(
    (field: EditableField) => {
      setEditing((current) => ({
        ...current,
        [field]: false,
      }));
      resetFieldDraft(field);
    },
    [resetFieldDraft],
  );

  const enableEditing = useCallback(
    (field: EditableField) => {
      setEditing((current) => ({
        ...current,
        [field]: true,
      }));
      setDrafts((current) => ({
        ...current,
        [field]: MASKED_FIELDS.has(field) ? '' : settings[field],
      }));
    },
    [settings],
  );

  const getSecretUpdateValue = (field: EditableField) => {
    const trimmed = drafts[field].trim();
    return trimmed ? trimmed : undefined;
  };

  const handleFieldBlur = useCallback(
    (field: EditableField, value: string) => {
      if (MASKED_FIELDS.has(field)) {
        if (!value.trim()) {
          cancelEditing(field);
        }

        return;
      }

      if (value === settings[field]) {
        cancelEditing(field);
      }
    },
    [cancelEditing, settings],
  );

  const saveSection = async (section: SectionName) => {
    if (section !== 'password' && !isSectionDirty(section)) {
      return;
    }

    if (section === 'password' && passwordError) {
      toaster.error({
        title: 'Password update failed',
        description: passwordError,
      });
      return;
    }

    setSavingSection(section);

    try {
      const body =
        section === 'bybit'
          ? {
              section,
              data: {
                apiKey: getSecretUpdateValue('bybitApiKey'),
                apiSecret: getSecretUpdateValue('bybitApiSecret'),
              },
            }
          : section === 'token'
            ? {
                section,
                data: {
                  token: getSecretUpdateValue('token'),
                },
              }
            : section === 'coinalyze'
              ? {
                  section,
                  data: {
                    apiKey: getSecretUpdateValue('coinalyzeApiKey'),
                  },
                }
              : section === 'openai'
                ? {
                    section,
                    data: {
                      apiKey: getSecretUpdateValue('openAIApiKey'),
                      apiEndpoint: getSecretUpdateValue('openAIApiEndpoint'),
                    },
                  }
                : section === 'telegram'
                  ? {
                      section,
                      data: {
                        botToken: getSecretUpdateValue('tgBotToken'),
                        chatId:
                          drafts.tgChatId !== settings.tgChatId
                            ? drafts.tgChatId.trim()
                            : undefined,
                      },
                    }
                  : {
                      section,
                      data: {
                        password: passwords.password,
                        confirmPassword: passwords.confirmPassword,
                      },
                    };

      const response = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as
        | SettingsResponse
        | SettingsErrorResponse;

      if (!response.ok || !isSettingsResponse(payload)) {
        throw new Error(
          getErrorMessage(payload, 'Failed to save account settings'),
        );
      }

      syncState(payload);

      if (section === 'password') {
        setPasswords(EMPTY_PASSWORDS);
      }

      toaster.success({
        title: 'Settings saved',
        description:
          section === 'password'
            ? 'Password updated successfully.'
            : 'Account settings updated successfully.',
      });
    } catch (error) {
      toaster.error({
        title: 'Save failed',
        description: (error as Error).message,
      });
    } finally {
      setSavingSection(null);
    }
  };

  const renderEditableField = ({
    label,
    field,
    placeholder,
  }: {
    label: string;
    field: EditableField;
    placeholder?: string;
  }) => {
    const isEditing = editing[field];
    const savedValue = settings[field];
    const isMasked = MASKED_FIELDS.has(field);

    return (
      <Field.Root key={field} width="full">
        <Field.Label>{label}</Field.Label>
        <HStack align="stretch" width="full">
          {isEditing ? (
            <Input
              flex="1"
              minW="0"
              value={drafts[field]}
              placeholder={placeholder}
              onChange={(event) => updateDraft(field, event.target.value)}
              onBlur={(event) => handleFieldBlur(field, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelEditing(field);
                }
              }}
              autoFocus
              fontFamily={isMasked ? 'mono' : undefined}
              fontVariantNumeric="tabular-nums"
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
                color={savedValue ? 'gray.200' : 'gray.500'}
                fontFamily={savedValue ? 'mono' : undefined}
                fontVariantNumeric="tabular-nums"
              >
                {savedValue || 'Not set'}
              </Text>
            </Flex>
          )}
          <IconButton
            aria-label={`Edit ${label}`}
            size="md"
            colorPalette="teal"
            variant={isEditing ? 'solid' : 'outline'}
            flexShrink={0}
            onClick={() => enableEditing(field)}
          >
            <FiEdit2 />
          </IconButton>
        </HStack>
      </Field.Root>
    );
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(event) => setOpen(event.open)}
      size="xl"
    >
      <Drawer.Trigger asChild>
        <IconButton
          aria-label="Account settings"
          size="md"
          colorPalette="teal"
          variant="outline"
        >
          <FiSettings />
        </IconButton>
      </Drawer.Trigger>
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content display="flex" flexDirection="column">
            <Drawer.Header>
              <Drawer.Title>Account settings</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton position="absolute" right="3" top="3" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body overflowY="auto">
              {loading ? (
                <Flex minH="320px" align="center" justify="center">
                  <Spinner color="teal.300" size="lg" />
                </Flex>
              ) : (
                <Stack gap={5}>
                  <Box>
                    <Text fontSize="sm" color="gray.400">
                      Signed in as
                    </Text>
                    <Text fontSize="lg" fontWeight="600">
                      {settings.userName || 'Unknown user'}
                    </Text>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">Bybit connection</Text>
                        <Text fontSize="sm" color="gray.400">
                          API credentials used for exchange access.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'BYBIT_API_KEY',
                        field: 'bybitApiKey',
                        placeholder: 'Enter a new Bybit API key',
                      })}
                      {renderEditableField({
                        label: 'BYBIT_API_SECRET',
                        field: 'bybitApiSecret',
                        placeholder: 'Enter a new Bybit API secret',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'bybit'}
                          disabled={!isSectionDirty('bybit')}
                          onClick={() => saveSection('bybit')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">OpenAI / LLM</Text>
                        <Text fontSize="sm" color="gray.400">
                          Stored in the user profile and used for AI analysis.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'OPENAI_API_ENDPOINT',
                        field: 'openAIApiEndpoint',
                        placeholder: 'Enter a new OpenAI API endpoint',
                      })}
                      {renderEditableField({
                        label: 'OPENAI_API_KEY',
                        field: 'openAIApiKey',
                        placeholder: 'Enter a new OpenAI API key',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'openai'}
                          disabled={!isSectionDirty('openai')}
                          onClick={() => saveSection('openai')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">Coinalyze</Text>
                        <Text fontSize="sm" color="gray.400">
                          API key stored in the user profile for derivatives
                          data ingestion.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'COINALYZE_API_KEY',
                        field: 'coinalyzeApiKey',
                        placeholder: 'Enter a new Coinalyze API key',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'coinalyze'}
                          disabled={!isSectionDirty('coinalyze')}
                          onClick={() => saveSection('coinalyze')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">Telegram</Text>
                        <Text fontSize="sm" color="gray.400">
                          Bot credentials used for signal delivery.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'TG_BOT_TOKEN',
                        field: 'tgBotToken',
                        placeholder: 'Enter a new Telegram bot token',
                      })}
                      {renderEditableField({
                        label: 'TG_CHAT_ID',
                        field: 'tgChatId',
                        placeholder: 'Enter Telegram chat ID',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'telegram'}
                          disabled={!isSectionDirty('telegram')}
                          onClick={() => saveSection('telegram')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">Password</Text>
                        <Text fontSize="sm" color="gray.400">
                          Update the password used for sign in.
                        </Text>
                      </Box>
                      <Field.Root>
                        <Field.Label>Password</Field.Label>
                        <Input
                          type="password"
                          value={passwords.password}
                          onChange={(event) =>
                            setPasswords((current) => ({
                              ...current,
                              password: event.target.value,
                            }))
                          }
                        />
                      </Field.Root>
                      <Field.Root>
                        <Field.Label>Confirm password</Field.Label>
                        <Input
                          type="password"
                          value={passwords.confirmPassword}
                          onChange={(event) =>
                            setPasswords((current) => ({
                              ...current,
                              confirmPassword: event.target.value,
                            }))
                          }
                        />
                      </Field.Root>
                      {passwordError ? (
                        <Text fontSize="sm" color="red.300">
                          {passwordError}
                        </Text>
                      ) : null}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'password'}
                          disabled={
                            !isSectionDirty('password') ||
                            Boolean(passwordError)
                          }
                          onClick={() => saveSection('password')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>

                  <Box
                    borderWidth="1px"
                    borderColor="gray.700"
                    borderRadius="lg"
                    p={4}
                    bg="gray.900"
                  >
                    <Stack gap={4}>
                      <Box>
                        <Text fontWeight="600">Passwordless auth token</Text>
                        <Text fontSize="sm" color="gray.400">
                          Token accepted in dashboard links for instant auth.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'TOKEN',
                        field: 'token',
                        placeholder: 'Enter a new passwordless token',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'token'}
                          disabled={!isSectionDirty('token')}
                          onClick={() => saveSection('token')}
                        >
                          Save
                        </Button>
                      </Flex>
                    </Stack>
                  </Box>
                </Stack>
              )}
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
