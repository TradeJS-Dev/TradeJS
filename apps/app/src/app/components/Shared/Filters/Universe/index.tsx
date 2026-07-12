'use client';

import { Select } from '#ui';
import type { MarketUniverse } from '@tradejs/types';
import { getDefaultMarketSymbol } from '#app/lib/marketDefaults';
import { useFiltersContext } from '../context';

export const SelectUniverse = () => {
  const { filters, onChangeFilters } = useFiltersContext();
  const items =
    filters.provider === 'bybit'
      ? [
          { value: 'crypto', label: 'Crypto' },
          { value: 'tradfi', label: 'TradFi' },
        ]
      : [{ value: 'crypto', label: 'Crypto' }];

  return (
    <Select
      key={`${filters.provider}:${filters.universe}`}
      defaultValue={[filters.universe ?? 'crypto']}
      onChange={(value: string[]) => {
        if (!value[0]) return;
        const universe = value[0] as MarketUniverse;
        onChangeFilters?.({
          universe,
          symbol: getDefaultMarketSymbol(filters.provider ?? 'bybit', universe),
          backtestId: null,
          backtestStrategy: null,
        });
      }}
      items={items}
      width="120px"
    />
  );
};
