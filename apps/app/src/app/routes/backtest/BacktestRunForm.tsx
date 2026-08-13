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
import { useBacktestRunsController } from './useBacktestRunsController';

type BacktestRunsController = ReturnType<typeof useBacktestRunsController>;

const PERIOD_ITEMS = [
  { label: 'Days', value: 'days' },
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

const controlSurface = 'rgba(255, 255, 255, 0.035)';
const controlSurfaceHover = 'rgba(255, 255, 255, 0.05)';

const inputControlProps = {
  bg: controlSurface,
  borderColor: 'gray.700',
  color: 'gray.100',
  _placeholder: { color: 'gray.500' },
  _hover: {
    bg: controlSurfaceHover,
    borderColor: 'gray.600',
  },
  _focusVisible: {
    borderColor: 'gray.500',
    boxShadow: '0 0 0 1px var(--chakra-colors-gray-500)',
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
        borderColor: 'var(--chakra-colors-gray-700)',
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
      '& [data-part="indicator-group"]': {
        flexShrink: '0',
      },
      '& [data-part="trigger"]:is(:hover, [data-hover]), & [data-part="input"]:is(:hover, [data-hover])':
        {
          background: controlSurfaceHover,
          borderColor: 'var(--chakra-colors-gray-600)',
        },
      '& [data-part="trigger"]:is(:focus-visible, [data-focus-visible]), & [data-part="input"]:is(:focus-visible, [data-focus-visible])':
        {
          borderColor: 'var(--chakra-colors-gray-500)',
          boxShadow: '0 0 0 1px var(--chakra-colors-gray-500)',
        },
      '& [data-part="control"]:is(:hover, [data-hover]) [data-part="input"]': {
        background: controlSurfaceHover,
        borderColor: 'var(--chakra-colors-gray-600)',
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
      color="gray.400"
      fontSize="xs"
      fontWeight="700"
      letterSpacing="0"
      textTransform="uppercase"
    >
      {title}
    </Text>
    <Grid templateColumns={columns} gap={3} alignItems="end">
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
  const { configs, starting, onboardingMode, form } = state;
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

  const handleStart = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void start();
  };

  return (
    <Box maxW="1200px" w="full">
      <Box
        borderWidth="1px"
        borderColor="gray.700"
        bg="gray.800"
        p={4}
        borderRadius="md"
      >
        <form onSubmit={handleStart}>
          <Stack gap={5}>
            <Flex alignItems="center" justifyContent="space-between" gap={4}>
              <Flex alignItems="center" gap={3} minW={0}>
                <Text fontWeight="700" flexShrink={0}>
                  New run
                </Text>
                {onboardingMode ? (
                  <Badge colorPalette="teal">First backtest preset</Badge>
                ) : null}
                {selectedConfig ? (
                  <Flex gap={2} wrap="wrap">
                    <Badge colorPalette="teal">
                      {selectedConfig.combinationCount} combos
                    </Badge>
                    <Badge colorPalette="gray">
                      {selectedConfig.paramCount} params
                    </Badge>
                  </Flex>
                ) : null}
              </Flex>
            </Flex>

            <FormSection title="Strategy" columns="repeat(2, minmax(0, 1fr))">
              <Field.Root>
                <Field.Label>Strategy</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Strategy"
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
                <Field.Label>Config</Field.Label>
                <SelectControl>
                  <Select
                    placeholder="Config"
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

            <Grid
              templateColumns="minmax(0, 1fr) 260px"
              gap={5}
              alignItems="start"
            >
              <FormSection
                title="Date window"
                columns={
                  periodMode === 'days'
                    ? '280px minmax(0, 1fr)'
                    : '280px repeat(2, minmax(0, 1fr))'
                }
              >
                <Field.Root>
                  <Field.Label>Mode</Field.Label>
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
                </Field.Root>

                {periodMode === 'days' ? (
                  <Field.Root>
                    <Field.Label>Days</Field.Label>
                    <Input
                      value={days}
                      type="number"
                      min={1}
                      step={1}
                      {...inputControlProps}
                      onChange={(event) =>
                        updateForm({ days: event.target.value })
                      }
                    />
                  </Field.Root>
                ) : (
                  <>
                    <Field.Root>
                      <Field.Label>Start</Field.Label>
                      <Input
                        value={startDate}
                        type="date"
                        {...inputControlProps}
                        onChange={(event) =>
                          updateForm({ startDate: event.target.value })
                        }
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>End</Field.Label>
                      <Input
                        value={endDate}
                        type="date"
                        {...inputControlProps}
                        onChange={(event) =>
                          updateForm({ endDate: event.target.value })
                        }
                      />
                    </Field.Root>
                  </>
                )}
              </FormSection>

              <FormSection title="Options" columns="1fr">
                <Flex gap={4} alignItems="center" minH="40px">
                  <Checkbox.Root
                    colorPalette="teal"
                    checked={ai}
                    onCheckedChange={(details) =>
                      updateForm({ ai: details.checked === true })
                    }
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control
                      bg={controlSurface}
                      borderColor="gray.600"
                    />
                    <Checkbox.Label>AI</Checkbox.Label>
                  </Checkbox.Root>
                  <Checkbox.Root
                    colorPalette="teal"
                    checked={fast}
                    onCheckedChange={(details) =>
                      updateForm({ fast: details.checked === true })
                    }
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control
                      bg={controlSurface}
                      borderColor="gray.600"
                    />
                    <Checkbox.Label>Fast</Checkbox.Label>
                  </Checkbox.Root>
                </Flex>
              </FormSection>
            </Grid>

            <FormSection title="Runtime" columns="220px 260px minmax(0, 1fr)">
              <Field.Root>
                <Field.Label>Interval</Field.Label>
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
                <Field.Label>Connector</Field.Label>
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

              <Field.Root>
                <Field.Label>Tickers</Field.Label>
                <Stack gap={2} w="full" minW={0}>
                  <SelectControl>
                    <SelectWithSearch
                      key={connector}
                      multiple
                      placeholder="All tickers"
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
                          <Box
                            as="span"
                            role="button"
                            tabIndex={0}
                            aria-label={`Remove ${ticker}`}
                            color="gray.300"
                            cursor="pointer"
                            _hover={{ color: 'white' }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedTickers((currentTickers) =>
                                  currentTickers.filter(
                                    (currentTicker) => currentTicker !== ticker,
                                  ),
                                );
                              }
                            }}
                            onClick={() =>
                              setSelectedTickers((currentTickers) =>
                                currentTickers.filter(
                                  (currentTicker) => currentTicker !== ticker,
                                ),
                              )
                            }
                          >
                            <FiX size={12} />
                          </Box>
                        </Badge>
                      ))}
                    </Flex>
                  ) : null}
                </Stack>
              </Field.Root>
            </FormSection>

            <FormSection title="Limits" columns="repeat(3, 1fr)">
              <Field.Root>
                <Field.Label>Tickers limit</Field.Label>
                <Input
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
                <Field.Label>Tests limit</Field.Label>
                <Input
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
                <Field.Label>Parallel</Field.Label>
                <Input
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

            <Flex justifyContent="flex-end" pt={1}>
              <Button
                type="submit"
                colorPalette="teal"
                disabled={!selectedConfigId || starting}
                loading={starting}
                minW="160px"
              >
                <FiPlay />
                Start
              </Button>
            </Flex>
          </Stack>
        </form>
      </Box>
    </Box>
  );
};
