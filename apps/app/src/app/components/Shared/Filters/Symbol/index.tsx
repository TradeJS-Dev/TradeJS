'use client';

import _ from 'lodash';
import { SelectWithSearch } from '#ui';
import { useFiltersContext } from '../context';

interface SelectSymbolProps {}

export const SelectSymbol = ({}: SelectSymbolProps) => {
  const { filters, tickers, onChangeFilters, ensureTickersLoaded } =
    useFiltersContext();
  const defaultInputValue =
    tickers.find(({ value }) => value === filters.symbol)?.label ||
    filters.symbol.replace(/USDT$/i, '');

  const onChange = (value: string[]) => {
    if (_.isEmpty(value)) {
      return;
    }

    const newFilters = {
      symbol: value[0],
      backtestId: null,
      backtestStrategy: null,
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <SelectWithSearch
      key={`${filters.provider}:${filters.universe}:${filters.symbol}`}
      defaultValue={[filters.symbol]}
      defaultInputValue={defaultInputValue}
      onChange={onChange}
      onOpenChange={(open) => {
        if (open) {
          void Promise.resolve(ensureTickersLoaded?.()).catch(() => undefined);
        }
      }}
      items={tickers}
      width="240px"
    />
  );
};
