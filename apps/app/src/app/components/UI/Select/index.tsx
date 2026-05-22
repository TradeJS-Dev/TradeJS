'use client';

import { useMemo } from 'react';
import {
  Portal,
  Stack,
  Span,
  Select as UISelect,
  createListCollection,
} from '@chakra-ui/react';
import { Items } from '@tradejs/types';

interface SelectProps {
  defaultValue: string[];
  value?: string[];
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

export const Select = ({
  defaultValue,
  value,
  items,
  multiple = false,
  placeholder = 'Select',
  emptyState = 'No items found',
  width = '320px',
  disabled = false,
  size = 'sm',
  onChange,
  onOpenChange,
}: SelectProps) => {
  const collection = useMemo(
    () =>
      createListCollection({
        items,
      }),
    [items],
  );

  return (
    <UISelect.Root
      collection={collection}
      {...(value ? { value } : { defaultValue })}
      onValueChange={(details) => onChange?.(details.value)}
      onOpenChange={(details) => onOpenChange?.(details.open)}
      size={size}
      multiple={multiple}
      width={width}
      disabled={disabled}
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
            {collection.items.length === 0 ? (
              <Span color="fg.muted" px="3" py="2" textStyle="sm">
                {emptyState}
              </Span>
            ) : (
              collection.items.map((item) => (
                <UISelect.Item item={item} key={item.value}>
                  <Stack gap="0">
                    <UISelect.ItemText>{item.label}</UISelect.ItemText>
                    {item.description && (
                      <Span color="fg.muted" textStyle="xs">
                        {item.description}
                      </Span>
                    )}
                  </Stack>
                  <UISelect.ItemIndicator />
                </UISelect.Item>
              ))
            )}
          </UISelect.Content>
        </UISelect.Positioner>
      </Portal>
    </UISelect.Root>
  );
};
