'use client';

import { Select } from '#ui';
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
    onChangeFilters?.({
      provider: value[0] as 'bybit' | 'binance' | 'coinbase',
      ...(value[0] === 'bybit' ? {} : { universe: 'crypto' }),
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
