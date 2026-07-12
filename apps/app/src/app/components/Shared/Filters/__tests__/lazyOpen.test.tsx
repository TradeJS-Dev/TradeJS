import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { FiltersContext } from '../context';
import { SelectSymbol } from '../Symbol';
import { SelectBacktest } from '../Backtest';
import { SelectUniverse } from '../Universe';

jest.mock('#ui', () => ({
  SelectWithSearch: ({
    onOpenChange,
  }: {
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
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

describe('filters lazy open', () => {
  it('loads tickers only when symbol select opens', () => {
    const ensureTickersLoaded = jest.fn();

    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: {
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          },
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

  it('loads backtests only when strategy/backtest selects open', () => {
    const ensureBacktestsLoaded = jest.fn();

    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: {
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          },
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

  it('disables strategy select when there are no backtests for the symbol', () => {
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: {
            provider: 'bybit',
            symbol: 'BTCUSDT',
            interval: '15',
          },
          tickers: [],
          backtestFiles: [],
        }}
      >
        <SelectBacktest />
      </FiltersContext.Provider>,
    );

    expect(getByTestId('No strategies-disabled').textContent).toBe('true');
  });

  it('resets the symbol when the market universe changes', () => {
    const onChangeFilters = jest.fn();
    const { getByTestId } = render(
      <FiltersContext.Provider
        value={{
          filters: {
            provider: 'bybit',
            universe: 'crypto',
            symbol: 'ETHUSDT',
            interval: '15',
          },
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
