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
import {
  AI_RESPONSE_LANGUAGE_OPTIONS,
  normalizeAiResponseLanguage,
} from '@tradejs/infra/aiLanguages';
import {
  AI_CUSTOM_ENDPOINT_VALUE,
  AI_ENDPOINT_OPTIONS,
  normalizeAiEndpoint,
} from '@tradejs/infra/aiEndpoints';
import {
  AI_CUSTOM_MODEL_VALUE,
  getAiModelOptionsForEndpoint,
  hasPresetAiModelsForEndpoint,
  normalizeAiModel,
} from '@tradejs/infra/aiModels';
import { toaster } from '#ui';

type SettingsResponse = {
  userName: string;
  settings: {
    bybit: {
      apiKey: string;
      apiSecret: string;
    };
    coinalyze: {
      apiKey: string;
    };
    coinmarketcap: {
      apiKey: string;
    };
    ai: {
      apiKey: string;
      apiEndpoint: string;
      model: string;
      responseLanguage: string;
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
  coinalyzeApiKey: string;
  coinmarketcapApiKey: string;
  aiApiKey: string;
  aiApiEndpoint: string;
  aiModel: string;
  aiResponseLanguage: string;
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
  | 'coinalyze'
  | 'coinmarketcap'
  | 'ai'
  | 'telegram';
type EditableField =
  | 'bybitApiKey'
  | 'bybitApiSecret'
  | 'coinalyzeApiKey'
  | 'coinmarketcapApiKey'
  | 'aiApiKey'
  | 'aiApiEndpoint'
  | 'aiModel'
  | 'aiResponseLanguage'
  | 'tgBotToken'
  | 'tgChatId';

const EMPTY_SETTINGS: SettingsViewState = {
  userName: '',
  bybitApiKey: '',
  bybitApiSecret: '',
  coinalyzeApiKey: '',
  coinmarketcapApiKey: '',
  aiApiKey: '',
  aiApiEndpoint: '',
  aiModel: '',
  aiResponseLanguage: '',
  tgBotToken: '',
  tgChatId: '',
};

const EMPTY_DRAFTS: SettingsDraftState = {
  bybitApiKey: '',
  bybitApiSecret: '',
  coinalyzeApiKey: '',
  coinmarketcapApiKey: '',
  aiApiKey: '',
  aiApiEndpoint: '',
  aiModel: '',
  aiResponseLanguage: '',
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
  coinalyzeApiKey: false,
  coinmarketcapApiKey: false,
  aiApiKey: false,
  aiApiEndpoint: false,
  aiModel: false,
  aiResponseLanguage: false,
  tgBotToken: false,
  tgChatId: false,
};

const SECTION_FIELDS: Record<
  Exclude<SectionName, 'password'>,
  EditableField[]
> = {
  bybit: ['bybitApiKey', 'bybitApiSecret'],
  coinalyze: ['coinalyzeApiKey'],
  coinmarketcap: ['coinmarketcapApiKey'],
  ai: ['aiApiKey', 'aiApiEndpoint', 'aiModel', 'aiResponseLanguage'],
  telegram: ['tgBotToken', 'tgChatId'],
};

const MASKED_FIELDS = new Set<EditableField>([
  'bybitApiKey',
  'bybitApiSecret',
  'coinalyzeApiKey',
  'coinmarketcapApiKey',
  'aiApiKey',
  'tgBotToken',
]);

const toViewState = (payload: SettingsResponse): SettingsViewState => ({
  userName: payload.userName,
  bybitApiKey: payload.settings.bybit.apiKey || '',
  bybitApiSecret: payload.settings.bybit.apiSecret || '',
  coinalyzeApiKey: payload.settings.coinalyze.apiKey || '',
  coinmarketcapApiKey: payload.settings.coinmarketcap.apiKey || '',
  aiApiKey: payload.settings.ai.apiKey || '',
  aiApiEndpoint:
    normalizeAiEndpoint(payload.settings.ai.apiEndpoint) ||
    AI_ENDPOINT_OPTIONS[0].value,
  aiModel:
    normalizeAiModel(
      payload.settings.ai.model,
      normalizeAiEndpoint(payload.settings.ai.apiEndpoint) ||
        AI_ENDPOINT_OPTIONS[0].value,
    ) ||
    payload.settings.ai.model ||
    '',
  aiResponseLanguage: normalizeAiResponseLanguage(
    payload.settings.ai.responseLanguage,
  ),
  tgBotToken: payload.settings.telegram.botToken || '',
  tgChatId: payload.settings.telegram.chatId || '',
});

const toDraftState = (view: SettingsViewState): SettingsDraftState => ({
  ...EMPTY_DRAFTS,
  aiApiEndpoint: view.aiApiEndpoint,
  aiModel: view.aiModel,
  aiResponseLanguage: view.aiResponseLanguage,
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

const getDraftAiEndpoint = (drafts: SettingsDraftState) =>
  normalizeAiEndpoint(drafts.aiApiEndpoint) || drafts.aiApiEndpoint.trim();

const getSelectedAiModelOption = (aiModel: string, aiEndpoint: string) => {
  const trimmedModel = aiModel.trim();

  return getAiModelOptionsForEndpoint(aiEndpoint).some(
    (option) => option.value === trimmedModel,
  )
    ? trimmedModel
    : AI_CUSTOM_MODEL_VALUE;
};

const DRAWER_SELECT_STYLE = {
  width: '100%',
  height: '40px',
  paddingLeft: '12px',
  paddingRight: '48px',
  borderWidth: '1px',
  borderColor: 'rgba(255, 255, 255, 0.16)',
  borderRadius: '0.375rem',
  background: 'rgba(0, 0, 0, 0.32)',
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' viewBox='0 0 14 9' fill='none'%3E%3Cpath d='M1 1.5L7 7.5L13 1.5' stroke='%23E5E7EB' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 16px center',
  backgroundSize: '14px 9px',
  color: 'rgb(229, 231, 235)',
} as const;

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

      if (section === 'ai') {
        const draftAiEndpoint = getDraftAiEndpoint(drafts);
        return (
          Boolean(drafts.aiApiKey.trim()) ||
          draftAiEndpoint !== settings.aiApiEndpoint ||
          drafts.aiModel.trim() !== settings.aiModel ||
          drafts.aiResponseLanguage !== settings.aiResponseLanguage
        );
      }

      if (section === 'coinalyze') {
        return Boolean(drafts.coinalyzeApiKey.trim());
      }

      if (section === 'coinmarketcap') {
        return Boolean(drafts.coinmarketcapApiKey.trim());
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
          : section === 'coinalyze'
            ? {
                section,
                data: {
                  apiKey: getSecretUpdateValue('coinalyzeApiKey'),
                },
              }
            : section === 'ai'
              ? {
                  section,
                  data: {
                    apiKey: getSecretUpdateValue('aiApiKey'),
                    apiEndpoint: drafts.aiApiEndpoint,
                    model: drafts.aiModel.trim(),
                    responseLanguage: drafts.aiResponseLanguage,
                  },
                }
              : section === 'coinmarketcap'
                ? {
                    section,
                    data: {
                      apiKey: getSecretUpdateValue('coinmarketcapApiKey'),
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

  const selectedAiEndpointOption = AI_ENDPOINT_OPTIONS.some(
    (option) => option.value === drafts.aiApiEndpoint,
  )
    ? drafts.aiApiEndpoint
    : AI_CUSTOM_ENDPOINT_VALUE;
  const effectiveAiEndpoint = getDraftAiEndpoint(drafts);
  const hasPresetAiModels = hasPresetAiModelsForEndpoint(effectiveAiEndpoint);
  const aiModelOptions = getAiModelOptionsForEndpoint(effectiveAiEndpoint);
  const selectedAiModelOption = getSelectedAiModelOption(
    drafts.aiModel,
    effectiveAiEndpoint,
  );

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
                  <Text fontSize="sm" color="gray.400">
                    Signed in as{' '}
                    <Text
                      as="span"
                      fontSize="sm"
                      fontWeight="600"
                      color="gray.100"
                    >
                      {settings.userName || 'Unknown user'}
                    </Text>
                  </Text>

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
                        <Text fontWeight="600">CoinMarketCap</Text>
                        <Text fontSize="sm" color="gray.400">
                          API key stored in the user profile for historical
                          global market context ingestion.
                        </Text>
                      </Box>
                      {renderEditableField({
                        label: 'COINMARKETCAP_API_KEY',
                        field: 'coinmarketcapApiKey',
                        placeholder: 'Enter a new CoinMarketCap API key',
                      })}
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'coinmarketcap'}
                          disabled={!isSectionDirty('coinmarketcap')}
                          onClick={() => saveSection('coinmarketcap')}
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
                        <Text fontWeight="600">AI / LLM</Text>
                        <Text fontSize="sm" color="gray.400">
                          Stored in the user profile and used for AI analysis
                          and user-facing AI replies.
                        </Text>
                      </Box>
                      <Field.Root>
                        <Field.Label>AI_API_ENDPOINT</Field.Label>
                        <select
                          value={selectedAiEndpointOption}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setDrafts((current) => ({
                              ...current,
                              aiApiEndpoint:
                                nextValue === AI_CUSTOM_ENDPOINT_VALUE
                                  ? ''
                                  : nextValue,
                              aiModel:
                                nextValue === AI_CUSTOM_ENDPOINT_VALUE
                                  ? ''
                                  : normalizeAiModel('', nextValue),
                            }));
                          }}
                          style={DRAWER_SELECT_STYLE}
                        >
                          {AI_ENDPOINT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <Text mt="2" fontSize="sm" color="gray.400">
                          {effectiveAiEndpoint || 'Endpoint is not set yet.'}
                        </Text>
                      </Field.Root>
                      {selectedAiEndpointOption === AI_CUSTOM_ENDPOINT_VALUE ? (
                        <Field.Root>
                          <Field.Label>Custom AI API endpoint URL</Field.Label>
                          <Input
                            value={drafts.aiApiEndpoint}
                            placeholder="https://your-openai-compatible-endpoint/v1"
                            onChange={(event) =>
                              updateDraft('aiApiEndpoint', event.target.value)
                            }
                          />
                        </Field.Root>
                      ) : null}
                      {renderEditableField({
                        label: 'AI_API_KEY',
                        field: 'aiApiKey',
                        placeholder: 'Enter a new AI API key',
                      })}
                      {hasPresetAiModels ? (
                        <Field.Root>
                          <Field.Label>AI_MODEL</Field.Label>
                          <select
                            value={selectedAiModelOption}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              if (nextValue === AI_CUSTOM_MODEL_VALUE) {
                                updateDraft('aiModel', '');
                                return;
                              }

                              updateDraft('aiModel', nextValue);
                            }}
                            style={DRAWER_SELECT_STYLE}
                          >
                            {aiModelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                            <option value={AI_CUSTOM_MODEL_VALUE}>
                              Custom model
                            </option>
                          </select>
                        </Field.Root>
                      ) : null}
                      {!hasPresetAiModels ||
                      selectedAiModelOption === AI_CUSTOM_MODEL_VALUE ? (
                        <Field.Root>
                          <Field.Label>Custom AI model name</Field.Label>
                          <Input
                            value={drafts.aiModel}
                            placeholder="Enter an OpenAI-compatible model name"
                            onChange={(event) =>
                              updateDraft('aiModel', event.target.value)
                            }
                          />
                        </Field.Root>
                      ) : null}
                      <Field.Root>
                        <Field.Label>AI_RESPONSE_LANGUAGE</Field.Label>
                        <select
                          value={drafts.aiResponseLanguage}
                          onChange={(event) =>
                            updateDraft(
                              'aiResponseLanguage',
                              event.target.value,
                            )
                          }
                          style={DRAWER_SELECT_STYLE}
                        >
                          {AI_RESPONSE_LANGUAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field.Root>
                      <Flex justify="flex-end">
                        <Button
                          colorPalette="teal"
                          loading={savingSection === 'ai'}
                          disabled={!isSectionDirty('ai')}
                          onClick={() => saveSection('ai')}
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
                </Stack>
              )}
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};
