import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { FiltersContext } from '../context';
import { SelectSymbol } from '../Symbol';
import { SelectBacktest } from '../Backtest';

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
  }: {
    placeholder?: string;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button
        onClick={() => onOpenChange?.(true)}
        data-testid={`${placeholder}-open`}
      />
      <button
        onClick={() => onOpenChange?.(false)}
        data-testid={`${placeholder}-close`}
      />
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

    fireEvent.click(getByTestId('Strategy-open'));
    fireEvent.click(getByTestId('Backtest-open'));
    expect(ensureBacktestsLoaded).toHaveBeenCalledTimes(2);
  });
});
