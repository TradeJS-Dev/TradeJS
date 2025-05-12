'use client';

import { useMemo } from 'react';
import {
  Portal,
  Stack,
  Span,
  Select as UISelect,
  createListCollection,
} from '@chakra-ui/react';
import { Items } from '@types';

interface SelectProps {
  defaultValue: string[];
  items: Items;
  placeholder?: string;
  width?: string | number;
  multiple?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onChange?: (value: string[]) => void;
}

export const Select = ({
  defaultValue,
  items,
  multiple = false,
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
    [items],
  );

  return (
    <UISelect.Root
      collection={collection}
      defaultValue={defaultValue}
      onValueChange={(details) => onChange?.(details.value)}
      size={size}
      multiple={multiple}
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
            ))}
          </UISelect.Content>
        </UISelect.Positioner>
      </Portal>
    </UISelect.Root>
  );
};
