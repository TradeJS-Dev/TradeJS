'use client';

import { useMemo } from 'react';
import {
  Portal,
  Select as UISelect,
  createListCollection,
} from '@chakra-ui/react';

interface Item {
  label: string;
  value: string;
}

interface SelectProps {
  defaultValue: string[];
  items: Item[];
  placeholder?: string;
  width?: string | number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onChange?: (value: string[]) => void;
}

export const Select = ({
  defaultValue,
  items,
  placeholder = 'Select',
  width = '320px',
  size = 'sm',
  onChange,
}: SelectProps) => {
  const collection = useMemo(
    () =>
      createListCollection({
        items,
      }),
    [],
  );

  return (
    <UISelect.Root
      collection={collection}
      defaultValue={defaultValue}
      onValueChange={(details) => onChange?.(details.value)}
      size={size}
      width={width}
    >
      <UISelect.HiddenSelect />
      <UISelect.Control>
        <UISelect.Trigger>
          <UISelect.ValueText placeholder={placeholder} />
        </UISelect.Trigger>
        <UISelect.IndicatorGroup>
          <UISelect.Indicator />
        </UISelect.IndicatorGroup>
      </UISelect.Control>
      <Portal>
        <UISelect.Positioner>
          <UISelect.Content>
            {collection.items.map((item) => (
              <UISelect.Item item={item} key={item.value}>
                {item.label}
                <UISelect.ItemIndicator />
              </UISelect.Item>
            ))}
          </UISelect.Content>
        </UISelect.Positioner>
      </Portal>
    </UISelect.Root>
  );
};
