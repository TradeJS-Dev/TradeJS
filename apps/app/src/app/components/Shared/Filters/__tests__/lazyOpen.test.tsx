import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { FiltersContext } from '../context';
import type { UIFilters } from '#app/types/ui';
import { SelectSymbol } from '../Symbol';
import { SelectBacktest } from '../Backtest';
import { SelectUniverse } from '../Universe';

jest.mock('#ui', () => ({
  SelectWithSearch: ({
    onOpenChange,
    defaultInputValue,
  }: {
    onOpenChange?: (open: boolean) => void;
    defaultInputValue?: string;
  }) => (
    <div>
      <span data-testid="symbol-input-value">{defaultInputValue}</span>
      <button onClick={() => onOpenChange?.(true)} data-testid="symbol-open" />
      <button
        onClick={() => onOpenChange?.(false)}
        data-testid="symbol-close"
      />
    </div>
  ),
  Select: ({
    placeholder,
    onOpenChange,
    onChange,
    disabled,
    items = [],
  }: {
    placeholder?: string;
    onOpenChange?: (open: boolean) => void;
    onChange?: (value: string[]) => void;
    disabled?: boolean;
    items?: Array<{ value: string }>;
  }) => (
    <div>
      <span data-testid={`${placeholder}-disabled`}>
        {disabled ? 'true' : 'false'}
      </span>
      <button
        onClick={() => onOpenChange?.(true)}
        data-testid={`${placeholder}-open`}
        disabled={disabled}
      />
      <button
        onClick={() => onOpenChange?.(false)}
        data-testid={`${placeholder}-close`}
      />
      {items.map((item) => (
        <button
          key={item.value}
          data-testid={`select-${item.value}`}
          onClick={() => onChange?.([item.value])}
        />
      ))}
    </div>
  ),
}));

const createFilters = (overrides: Partial<UIFilters> = {}): UIFilters => ({
  provider: 'bybit',
  symbol: 'BTCUSDT',
  interval: '15',
  start: 0,
  end: 0,
  backtestId: null,
  backtestStrategy: null,
  ...overrides,
});

describe('filters lazy open', () => {
  it('loads tickers only when symbol select opens', () => {
    const ensureTickersLoaded = jest.fn();

    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          }),
          tickers: [],
          backtestFiles: [],
          ensureTickersLoaded,
        }}
      >
        <SelectSymbol />
      </FiltersContext.Provider>,
    );

    fireEvent.click(getByTestId('symbol-close'));
    expect(ensureTickersLoaded).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('symbol-open'));
    expect(ensureTickersLoaded).toHaveBeenCalledTimes(1);
  });

  it('shows the selected symbol even before TradFi tickers load', () => {
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'bybit',
            universe: 'tradfi',
            symbol: 'AAPLUSDT',
            interval: '15',
          }),
          tickers: [],
          backtestFiles: [],
        }}
      >
        <SelectSymbol />
      </FiltersContext.Provider>,
    );

    expect(getByTestId('symbol-input-value').textContent).toBe('AAPL');
  });

  it('loads backtests only when strategy/backtest selects open', () => {
    const ensureBacktestsLoaded = jest.fn();

    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          }),
          tickers: [],
          backtestFiles: [
            {
              value: 'BTCUSDT__1',
              label: 'BTCUSDT_1',
              data: { strategyName: 'TrendLine', netProfit: 10 },
            },
          ],
          ensureBacktestsLoaded,
        }}
      >
        <SelectBacktest />
      </FiltersContext.Provider>,
    );

    fireEvent.click(getByTestId('Strategy-close'));
    fireEvent.click(getByTestId('Backtest-close'));
    expect(ensureBacktestsLoaded).not.toHaveBeenCalled();
    expect(getByTestId('Backtest-disabled').textContent).toBe('true');

    fireEvent.click(getByTestId('Strategy-open'));
    fireEvent.click(getByTestId('Backtest-open'));
    expect(ensureBacktestsLoaded).toHaveBeenCalledTimes(1);
  });

  it('keeps strategy select enabled so an empty list can be loaded lazily', () => {
    const ensureBacktestsLoaded = jest.fn();
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          }),
          tickers: [],
          backtestFiles: [],
          ensureBacktestsLoaded,
        }}
      >
        <SelectBacktest />
      </FiltersContext.Provider>,
    );

    expect(getByTestId('Strategy-disabled').textContent).toBe('false');
    fireEvent.click(getByTestId('Strategy-open'));
    expect(ensureBacktestsLoaded).toHaveBeenCalledTimes(1);
  });

  it('restores backtest selects from the dashboard URL before the index loads', () => {
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'coinbase',
            symbol: 'BCHUSDT',
            interval: '15',
            backtestId: 'BCHUSDT_suite_test',
            backtestStrategy: 'AdaptiveMomentumRibbon',
          }),
          tickers: [],
          backtestFiles: [],
        }}
      >
        <SelectBacktest />
      </FiltersContext.Provider>,
    );

    expect(getByTestId('Strategy-disabled').textContent).toBe('false');
    expect(getByTestId('Backtest-disabled').textContent).toBe('false');
    expect(getByTestId('select-AdaptiveMomentumRibbon')).toBeTruthy();
    expect(getByTestId('select-BCHUSDT_suite_test')).toBeTruthy();
  });

  it('resets the symbol when the market universe changes', () => {
    const onChangeFilters = jest.fn();
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: createFilters({
            provider: 'bybit',
            universe: 'crypto',
            symbol: 'ETHUSDT',
            interval: '15',
          }),
          tickers: [],
          backtestFiles: [],
          onChangeFilters,
        }}
      >
        <SelectUniverse />
      </FiltersContext.Provider>,
    );

    fireEvent.click(getByTestId('select-tradfi'));
    expect(onChangeFilters).toHaveBeenCalledWith({
      universe: 'tradfi',
      symbol: 'AAPLUSDT',
      backtestId: null,
      backtestStrategy: null,
    });
  });
});
