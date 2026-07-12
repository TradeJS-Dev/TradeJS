'use client';

import { Select } from '#ui';
import { getDefaultMarketSymbol } from '#app/lib/marketDefaults';
import { useFiltersContext } from '../context';

const items = [
  { value: 'bybit', label: 'ByBit' },
  { value: 'binance', label: 'Binance' },
  { value: 'coinbase', label: 'Coinbase' },
];

export const SelectProvider = () => {
  const { filters, onChangeFilters } = useFiltersContext();

  const onChange = (value: string[]) => {
    if (!value[0]) return;
    const provider = value[0] as 'bybit' | 'binance' | 'coinbase';
    const universe =
      provider === 'bybit' ? filters.universe ?? 'crypto' : 'crypto';
    onChangeFilters?.({
      provider,
      universe,
      symbol: getDefaultMarketSymbol(provider, universe),
      backtestId: null,
      backtestStrategy: null,
    });
  };

  return (
    <Select
      defaultValue={[filters.provider || 'bybit']}
      onChange={onChange}
      items={items}
      width="140px"
    />
  );
};
