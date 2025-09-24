'use client';

import {
  Portal,
  Stack,
  Span,
  Combobox,
  useFilter,
  useListCollection,
} from '@chakra-ui/react';
import { Items } from '@types';

interface SelectWithSearchProps {
  defaultValue: string[];
  items: Items;
  placeholder?: string;
  emptyState?: string;
  width?: string | number;
  multiple?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onChange?: (value: string[]) => void;
}

export const SelectWithSearch = ({
  defaultValue,
  items,
  multiple = false,
  placeholder = 'Select',
  emptyState = 'No items found',
  width = '320px',
  size = 'sm',
  onChange,
}: SelectWithSearchProps) => {
  const { contains } = useFilter({ sensitivity: 'base' });

  const { collection, filter } = useListCollection({
    initialItems: items,
    filter: contains,
  });

  return (
    <Combobox.Root
      collection={collection}
      defaultValue={defaultValue}
      onValueChange={(details) => onChange?.(details.value)}
      onInputValueChange={(e) => filter(e.inputValue)}
      width={width}
      multiple={multiple}
      size={size}
      openOnClick
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
          <Combobox.ClearTrigger />
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>{emptyState}</Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item item={item} key={item.value}>
                <Stack gap="0">
                  {item.label}
                  {item.description && (
                    <Span color="fg.muted" textStyle="xs">
                      {item.description}
                    </Span>
                  )}
                  <Combobox.ItemIndicator />
                </Stack>
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
};
