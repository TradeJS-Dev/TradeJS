'use client';

import _ from 'lodash';
import { useCallback, useEffect, useState } from 'react';
import {
  Portal,
  Stack,
  HStack,
  Span,
  Combobox,
  useFilter,
  useListCollection,
} from '@chakra-ui/react';
import { Items } from '@tradejs/types';

interface SelectWithSearchProps {
  defaultValue: string[];
  value?: string[];
  defaultInputValue?: string;
  items: Items;
  placeholder?: string;
  emptyState?: string;
  width?: string | number;
  multiple?: boolean;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onChange?: (value: string[]) => void;
  onOpenChange?: (open: boolean) => void;
}

export const SelectWithSearch = ({
  defaultValue,
  value,
  defaultInputValue,
  items,
  multiple = false,
  disabled = false,
  placeholder = 'Select',
  emptyState = 'No items found',
  width = '320px',
  size = 'sm',
  onChange,
  onOpenChange,
}: SelectWithSearchProps) => {
  const { contains } = useFilter({ sensitivity: 'base' });
  const defaultSelectedValue = defaultValue[0];
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const currentValue = value ?? selectedValue;
  const getSelectedInputValue = useCallback(
    (selected: string[]) => {
      if (multiple) return '';

      const selectedItem = selected[0];
      if (!selectedItem) return '';

      return (
        items.find((item) => item.value === selectedItem)?.label ??
        (selectedItem === defaultSelectedValue
          ? defaultInputValue
          : undefined) ??
        selectedItem
      );
    },
    [defaultInputValue, defaultSelectedValue, items, multiple],
  );
  const [inputValue, setInputValue] = useState(() =>
    getSelectedInputValue(currentValue),
  );

  const { collection, filter, set } = useListCollection({
    initialItems: items,
    filter: contains,
  });

  useEffect(() => {
    set(items);
  }, [items, set]);

  useEffect(() => {
    if (!isOpen) {
      setInputValue(getSelectedInputValue(currentValue));
    }
  }, [currentValue, getSelectedInputValue, isOpen]);

  return (
    <Combobox.Root
      collection={collection}
      {...(value ? { value } : { defaultValue })}
      inputValue={inputValue}
      onValueChange={(details) => {
        if (!value) {
          setSelectedValue(details.value);
        }
        setInputValue(getSelectedInputValue(details.value));
        onChange?.(details.value);
      }}
      onInputValueChange={(e) => {
        filter(e.inputValue);
        setInputValue(e.inputValue);
      }}
      onOpenChange={(details) => {
        setIsOpen(details.open);
        onOpenChange?.(details.open);
        if (details.open) {
          filter('');
          setInputValue('');
        } else {
          setInputValue(getSelectedInputValue(currentValue));
        }
      }}
      width={width}
      multiple={multiple}
      size={size}
      disabled={disabled}
      openOnClick
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} />
        <Combobox.IndicatorGroup>
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
