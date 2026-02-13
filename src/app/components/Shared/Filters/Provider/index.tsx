'use client';

import { Segment } from '@UI';
import { useFiltersContext } from '../context';

const items = [
  { value: 'bybit', label: 'ByBit' },
  { value: 'binance', label: 'Binance' },
  { value: 'coinbase', label: 'Coinbase' },
];

export const SelectProvider = () => {
  const { filters, onChangeFilters } = useFiltersContext();

  const onChange = (value: string | null) => {
    if (!value) return;
    onChangeFilters?.({
      provider: value as 'bybit' | 'binance' | 'coinbase',
      backtestId: null,
      backtestStrategy: null,
    });
  };

  return (
    <Segment
      defaultValue={filters.provider || 'bybit'}
      onChange={onChange}
      items={items}
    />
  );
};
