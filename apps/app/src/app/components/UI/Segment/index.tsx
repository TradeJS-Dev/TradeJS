'use client';

import { SegmentGroup } from '@chakra-ui/react';
import type { Items } from '#app/types/ui';

interface SegmentProps {
  defaultValue: string;
  value?: string;
  size?: 'xs' | 'md';
  items: Items;
  onChange?: (value: string | null) => void;
  'aria-label'?: string;
}

export const Segment = ({
  defaultValue,
  value,
  size = 'md',
  items,
  onChange,
  'aria-label': ariaLabel,
}: SegmentProps) => {
  return (
    <SegmentGroup.Root
      size={size}
      value={value}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      onValueChange={(e) => onChange?.(e.value)}
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Items items={items} />
    </SegmentGroup.Root>
  );
};
