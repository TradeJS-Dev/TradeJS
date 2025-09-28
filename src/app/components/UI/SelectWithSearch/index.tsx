'use client';

import _ from 'lodash';
import { useEffect, useState } from 'react';
import {
  Portal,
  Stack,
  HStack,
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
  const [inputValue, setInputValue] = useState(defaultValue?.[0]);

  const { collection, filter, set } = useListCollection({
    initialItems: items,
    filter: contains,
  });

  useEffect(() => {
    set(items);
  }, [items]);

  return (
    <Combobox.Root
      collection={collection}
      defaultValue={defaultValue}
      inputValue={inputValue}
      onValueChange={(details) => onChange?.(details.value)}
      onInputValueChange={(e) => {
        filter(e.inputValue);
        setInputValue(e.inputValue);
      }}
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
                <HStack gap={2}>
                  <Stack gap="0">
                    {item.label}
                    {item.description && (
                      <Span color="fg.muted" textStyle="xs">
                        {item.description}
                      </Span>
                    )}
                  </Stack>
                  <Combobox.ItemIndicator />
                </HStack>
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
};
