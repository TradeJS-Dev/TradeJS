'use client';

import React from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Grid,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react';
import { FiPlay, FiX } from 'react-icons/fi';
import { Segment, Select, SelectWithSearch } from '#ui';
import type { useBacktestRunsController } from './useBacktestRunsController';

type BacktestRunsController = ReturnType<typeof useBacktestRunsController>;

const PERIOD_ITEMS = [
  { label: 'Last N days', value: 'days' },
  { label: 'Date range', value: 'range' },
];
const INTERVAL_ITEMS = [
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '30m', value: '30' },
  { label: '1h', value: '60' },
  { label: '4h', value: '240' },
];
const CONNECTOR_ITEMS = [
  { label: 'Bybit', value: 'bybit' },
  { label: 'Binance', value: 'binance' },
  { label: 'Coinbase', value: 'coinbase' },
];

const controlSurface = 'var(--chakra-colors-gray-700)';
const controlSurfaceHover = 'var(--chakra-colors-gray-600)';

const inputControlProps = {
  bg: controlSurface,
  borderColor: 'gray.500',
  color: 'gray.100',
  _placeholder: { color: 'gray.300' },
  _hover: {
    bg: controlSurfaceHover,
    borderColor: 'gray.400',
  },
  _focusVisible: {
    borderColor: 'teal.300',
    boxShadow: '0 0 0 2px var(--chakra-colors-teal-300)',
  },
};

const SelectControl = ({ children }: { children: React.ReactNode }) => (
  <Box
    w="full"
    minW={0}
    css={{
      '& [data-part="control"]': {
        width: '100%',
      },
      '& [data-part="trigger"], & [data-part="input"]': {
        background: controlSurface,
        borderColor: 'var(--chakra-colors-gray-500)',
        color: 'var(--chakra-colors-gray-100)',
        minWidth: '0',
        width: '100%',
      },
      '& [data-part="trigger"]': {
        flex: '1',
        minHeight: '40px',
      },
      '& [data-part="input"]': {
        flex: '1',
        minHeight: '40px',
      },
      '& [data-part="input"]::placeholder': {
        color: 'var(--chakra-colors-gray-300)',
      },
      '& [data-part="indicator-group"]': {
        flexShrink: '0',
      },
      '& [data-part="trigger"]:is(:hover, [data-hover]), & [data-part="input"]:is(:hover, [data-hover])':
        {
          background: controlSurfaceHover,
          borderColor: 'var(--chakra-colors-gray-400)',
        },
      '& [data-part="trigger"]:is(:focus-visible, [data-focus-visible]), & [data-part="input"]:is(:focus-visible, [data-focus-visible])':
        {
          borderColor: 'var(--chakra-colors-teal-300)',
          boxShadow: '0 0 0 2px var(--chakra-colors-teal-300)',
        },
      '& [data-part="control"]:is(:hover, [data-hover]) [data-part="input"]': {
        background: controlSurfaceHover,
        borderColor: 'var(--chakra-colors-gray-400)',
      },
    }}
  >
    {children}
  </Box>
);

interface FormSectionProps {
  title: string;
  columns: string;
  children: React.ReactNode;
}

const FormSection = ({ title, columns, children }: FormSectionProps) => (
  <Stack gap={3} minW={0}>
    <Text
      as="h3"
      color="gray.300"
      fontSize="sm"
      fontWeight="700"
      letterSpacing="0"
      textTransform="none"
    >
      {title}
    </Text>
    <Grid
      templateColumns={{ base: 'minmax(0, 1fr)', md: columns }}
      gap={4}
      alignItems="start"
    >
      {children}
    </Grid>
  </Stack>
);

export const BacktestRunForm = ({
  controller,
}: {
  controller: BacktestRunsController;
}) => {
  const {
    state,
    strategyItems,
    configItems,
    selectedConfig,
    tickerItems,
    ensureTickersLoaded,
    updateForm,
    setSelectedTickers,
    start,
  } = controller;
  const { configs, loadingConfigs, starting, onboardingMode, form } = state;
  const {
    selectedStrategy,
    selectedConfigId,
    periodMode,
    days,
    startDate,
    endDate,
    ai,
    fast,
    interval,
    connector,
    selectedTickers,
    tickersLimit,
    testsLimit,
    parallel,
  } = form;
  const hasConfigs = configs.length > 0;
  const advancedCount = [tickersLimit, testsLimit, parallel].filter(
    Boolean,
  ).length;
  const periodValid =
    periodMode === 'days'
      ? Number.isInteger(Number(days)) && Number(days) > 0
      : Boolean(startDate && endDate && startDate <= endDate);
  const canStart = Boolean(
    selectedConfig &&
      selectedConfig.strategyName === selectedStrategy &&
      periodValid &&
      !loadingConfigs &&
      !starting,
  );
  const launchHint = loadingConfigs
    ? 'Loading configurations…'
    : !hasConfigs
      ? 'Create a backtest configuration to get started.'
      : !selectedConfig
        ? 'Choose a strategy and configuration.'
        : !periodValid
          ? 'Enter a valid period to continue.'
          : 'Review your settings, then launch the backtest.';
  const periodLabel =
    periodMode === 'days'
      ? `Last ${days || '—'} days`
      : `${startDate || '…'} → ${endDate || '…'} (UTC)`;

  const handleStart = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canStart) void start();
  };

  return (
    <Box
      maxW="1200px"
      w="full"
      borderWidth="1px"
      borderColor="gray.700"
      bg="gray.800"
      borderRadius="xl"
      overflow="hidden"
    >
      <form onSubmit={handleStart}>
        <Flex
          px={{ base: 4, md: 6 }}
          py={5}
          gap={3}
          align="center"
          justify="space-between"
          wrap="wrap"
          borderBottomWidth="1px"
          borderColor="gray.700"
        >
          <Stack gap={1}>
            <Text as="h2" fontSize="lg" fontWeight="700">
              New backtest
            </Text>
            <Text color="gray.400" fontSize="sm">
              Choose what to test and how far to look back.
            </Text>
          </Stack>
          {onboardingMode ? (
            <Badge colorPalette="teal">First backtest preset</Badge>
          ) : null}
        </Flex>
        <Grid
          templateColumns={{
            base: 'minmax(0, 1fr)',
            lg: 'minmax(0, 1fr) 300px',
          }}
        >
          <Stack gap={6} p={{ base: 4, md: 6 }} minW={0}>
            <FormSection
              title="Strategy & configuration"
              columns="repeat(2, minmax(0, 1fr))"
            >
              <Field.Root>
                <Field.Label>Strategy</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Select a strategy"
                    value={selectedStrategy ? [selectedStrategy] : []}
                    defaultValue={selectedStrategy ? [selectedStrategy] : []}
                    onChange={(value) =>
                      updateForm({ selectedStrategy: value[0] || '' })
                    }
                    items={strategyItems}
                    emptyState="No backtest configs"
                    width="100%"
                    disabled={!hasConfigs}
                  />
                </SelectControl>
              </Field.Root>

              <Field.Root>
                <Field.Label>Configuration</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Select a configuration"
                    value={selectedConfigId ? [selectedConfigId] : []}
                    defaultValue={selectedConfigId ? [selectedConfigId] : []}
                    onChange={(value) =>
                      updateForm({ selectedConfigId: value[0] || '' })
                    }
                    items={configItems}
                    emptyState="No configs for strategy"
                    width="100%"
                    disabled={!selectedStrategy}
                  />
                </SelectControl>
              </Field.Root>
            </FormSection>

            <FormSection title="Test period" columns="minmax(0, 1fr)">
              <Box
                css={{
                  '& [data-scope="segment-group"][data-part="root"]': {
                    background: 'var(--chakra-colors-gray-900)',
                    border: '1px solid var(--chakra-colors-gray-500)',
                  },
                  '& [data-part="indicator"]': {
                    background: 'var(--chakra-colors-gray-600)',
                    border: '1px solid var(--chakra-colors-gray-400)',
                  },
                }}
              >
                <Segment
                  defaultValue="days"
                  value={periodMode}
                  items={PERIOD_ITEMS}
                  onChange={(value) =>
                    updateForm({
                      periodMode: value === 'range' ? 'range' : 'days',
                    })
                  }
                />
              </Box>
              {periodMode === 'days' ? (
                <Field.Root invalid={!periodValid}>
                  <Field.Label>Number of days</Field.Label>
                  <Flex gap={2} wrap="wrap" align="center">
                    <Input
                      w="100px"
                      value={days}
                      type="number"
                      min={1}
                      step={1}
                      required
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ days: event.target.value })
                      }
                    />
                    <Flex
                      gap={1}
                      wrap="wrap"
                      role="group"
                      aria-label="Common periods"
                    >
                      {[7, 30, 90, 180].map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={days === String(preset) ? 'subtle' : 'ghost'}
                          colorPalette={
                            days === String(preset) ? 'teal' : 'gray'
                          }
                          aria-pressed={days === String(preset)}
                          onClick={() => updateForm({ days: String(preset) })}
                        >
                          {preset}d
                        </Button>
                      ))}
                    </Flex>
                  </Flex>
                  {periodValid ? (
                    <Field.HelperText>
                      Rolling window ending at the time of launch.
                    </Field.HelperText>
                  ) : (
                    <Field.ErrorText>
                      Enter a whole number of days greater than zero.
                    </Field.ErrorText>
                  )}
                </Field.Root>
              ) : (
                <Grid
                  templateColumns={{
                    base: 'minmax(0, 1fr)',
                    sm: 'repeat(2, minmax(0, 1fr))',
                  }}
                  gap={4}
                >
                  <Field.Root>
                    <Field.Label>Start date (UTC)</Field.Label>
                    <Input
                      value={startDate}
                      type="date"
                      max={endDate || undefined}
                      required
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ startDate: event.target.value })
                      }
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>End date (UTC)</Field.Label>
                    <Input
                      value={endDate}
                      type="date"
                      min={startDate || undefined}
                      required
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ endDate: event.target.value })
                      }
                    />
                  </Field.Root>
                </Grid>
              )}
            </FormSection>
            <FormSection
              title="Market & instruments"
              columns="minmax(0, 1fr) minmax(0, 1fr)"
            >
              <Field.Root>
                <Field.Label>Candle interval</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Interval"
                    value={[interval]}
                    defaultValue={[interval]}
                    onChange={(value) =>
                      updateForm({ interval: value[0] || '15' })
                    }
                    items={INTERVAL_ITEMS}
                    width="100%"
                  />
                </SelectControl>
              </Field.Root>

              <Field.Root>
                <Field.Label>Exchange</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Connector"
                    value={[connector]}
                    defaultValue={[connector]}
                    onChange={(value) => {
                      updateForm({
                        connector: value[0] || 'binance',
                        selectedTickers: [],
                      });
                    }}
                    items={CONNECTOR_ITEMS}
                    width="100%"
                  />
                </SelectControl>
              </Field.Root>

              <Field.Root gridColumn="1 / -1">
                <Field.Label>Instruments</Field.Label>
                <Stack gap={2} w="full" minW={0}>
                  <SelectControl>
                    <SelectWithSearch
                      key={connector}
                      multiple
                      placeholder={
                        selectedTickers.length
                          ? 'Search instruments…'
                          : 'All available instruments'
                      }
                      emptyState="No tickers"
                      defaultValue={[]}
                      value={selectedTickers}
                      items={tickerItems}
                      width="100%"
                      onChange={setSelectedTickers}
                      onOpenChange={(open) => {
                        if (open) {
                          void ensureTickersLoaded().catch(() => undefined);
                        }
                      }}
                    />
                  </SelectControl>
                  {selectedTickers.length ? (
                    <Flex gap={2} wrap="wrap">
                      {selectedTickers.map((ticker) => (
                        <Badge
                          key={ticker}
                          colorPalette="teal"
                          display="inline-flex"
                          alignItems="center"
                          gap={1}
                          py="1"
                        >
                          {ticker}
                          <Button
                            type="button"
                            variant="plain"
                            size="xs"
                            minW="24px"
                            h="24px"
                            p={0}
                            aria-label={`Remove ${ticker}`}
                            color="gray.300"
                            cursor="pointer"
                            _hover={{ color: 'white' }}
                            onClick={() =>
                              setSelectedTickers((currentTickers) =>
                                currentTickers.filter(
                                  (currentTicker) => currentTicker !== ticker,
                                ),
                              )
                            }
                          >
                            <FiX size={12} />
                          </Button>
                        </Badge>
                      ))}
                    </Flex>
                  ) : null}
                </Stack>
              </Field.Root>
            </FormSection>

            <Box
              as="details"
              borderTopWidth="1px"
              borderColor="gray.700"
              pt={4}
              css={{
                '& > summary': { cursor: 'pointer', borderRadius: '4px' },
                '& > summary:focus-visible': {
                  outline: '2px solid var(--chakra-colors-teal-400)',
                  outlineOffset: '4px',
                },
              }}
            >
              <Box as="summary" color="gray.300" fontSize="sm" fontWeight="600">
                Advanced settings
                {advancedCount ? ` · ${advancedCount} custom` : ''}
              </Box>
              <Box pt={4}>
                <FormSection title="Execution limits" columns="repeat(3, 1fr)">
                  <Field.Root>
                    <Field.Label>Max instruments</Field.Label>
                    <Input
                      placeholder="No limit"
                      value={tickersLimit}
                      type="number"
                      min={1}
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ tickersLimit: event.target.value })
                      }
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Max tests</Field.Label>
                    <Input
                      placeholder="No limit"
                      value={testsLimit}
                      type="number"
                      min={1}
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ testsLimit: event.target.value })
                      }
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Parallel workers</Field.Label>
                    <Input
                      placeholder="Automatic"
                      value={parallel}
                      type="number"
                      min={1}
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ parallel: event.target.value })
                      }
                    />
                  </Field.Root>
                </FormSection>

                <Text fontSize="xs" color="gray.400" mt={3}>
                  Leave limits empty to run all tests. Worker count is chosen
                  automatically.
                </Text>
              </Box>
            </Box>
          </Stack>
          <Stack
            as="aside"
            aria-label="Run summary"
            minW={0}
            gap={5}
            p={{ base: 4, md: 6 }}
            bg="rgba(0, 0, 0, 0.14)"
            borderLeftWidth={{ base: '0', lg: '1px' }}
            borderTopWidth={{ base: '1px', lg: '0' }}
            borderColor="gray.700"
          >
            <Stack gap={1}>
              <Text fontWeight="600" color="teal.300" fontSize="sm">
                Run summary
              </Text>
              <Text fontSize="lg" fontWeight="700" overflowWrap="anywhere">
                {selectedStrategy || 'Choose a strategy'}
              </Text>
              <Text fontSize="sm" color="gray.400" overflowWrap="anywhere">
                {selectedConfigId || 'No configuration selected'}
              </Text>
            </Stack>
            <Stack as="dl" gap={3} fontSize="sm" m={0}>
              {[
                ['Period', periodLabel],
                [
                  'Exchange',
                  CONNECTOR_ITEMS.find((item) => item.value === connector)
                    ?.label || connector,
                ],
                [
                  'Candle interval',
                  INTERVAL_ITEMS.find((item) => item.value === interval)
                    ?.label || interval,
                ],
                [
                  'Instruments',
                  selectedTickers.length
                    ? `${selectedTickers.length} selected`
                    : 'All available',
                ],
                [
                  'Combinations',
                  selectedConfig
                    ? selectedConfig.combinationCount.toLocaleString()
                    : '—',
                ],
                ...(tickersLimit ? [['Max instruments', tickersLimit]] : []),
                ...(testsLimit ? [['Max tests', testsLimit]] : []),
                ...(parallel ? [['Parallel workers', parallel]] : []),
              ].map(([label, value]) => (
                <Flex key={label} justify="space-between" gap={3}>
                  <Text as="dt" color="gray.400" flexShrink={0}>
                    {label}
                  </Text>
                  <Text as="dd" m={0} textAlign="right" overflowWrap="anywhere">
                    {value}
                  </Text>
                </Flex>
              ))}
            </Stack>
            <Stack gap={4} borderTopWidth="1px" borderColor="gray.700" pt={5}>
              <Checkbox.Root
                colorPalette="teal"
                alignItems="start"
                checked={ai}
                onCheckedChange={(details) =>
                  updateForm({ ai: details.checked === true })
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control
                  flexShrink={0}
                  mt="2px"
                  bg="gray.700"
                  borderColor="gray.500"
                  _checked={{ bg: 'teal.500', borderColor: 'teal.300' }}
                >
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>
                  <Text fontSize="sm" fontWeight="500">
                    Export AI dataset
                  </Text>
                  <Text fontSize="xs" color="gray.400" mt={1}>
                    Save prompt rows for later AI research.
                  </Text>
                </Checkbox.Label>
              </Checkbox.Root>
              <Checkbox.Root
                colorPalette="teal"
                alignItems="start"
                checked={fast}
                onCheckedChange={(details) =>
                  updateForm({ fast: details.checked === true })
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control
                  flexShrink={0}
                  mt="2px"
                  bg="gray.700"
                  borderColor="gray.500"
                  _checked={{ bg: 'teal.500', borderColor: 'teal.300' }}
                >
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Label>
                  <Text fontSize="sm" fontWeight="500">
                    Fast mode
                  </Text>
                  <Text fontSize="xs" color="gray.400" mt={1}>
                    Skip per-test artifacts to reduce disk writes.
                  </Text>
                </Checkbox.Label>
              </Checkbox.Root>
            </Stack>
            <Stack gap={3} mt="auto" pt={3}>
              <Text
                fontSize="xs"
                color="gray.400"
                id="backtest-launch-hint"
                role="status"
              >
                {launchHint}
              </Text>
              <Button
                type="submit"
                colorPalette="teal"
                disabled={!canStart}
                loading={starting}
                loadingText="Starting…"
                w="full"
                size="lg"
                aria-describedby="backtest-launch-hint"
              >
                <FiPlay />
                Start backtest
              </Button>
            </Stack>
          </Stack>
        </Grid>
      </form>
    </Box>
  );
};
