'use client';

import { SegmentGroup } from '@chakra-ui/react';
import { Items } from '@tradejs/types';

interface SegmentProps {
  defaultValue: string;
  value?: string;
  items: Items;
  onChange?: (value: string | null) => void;
}

export const Segment = ({
  defaultValue,
  value,
  items,
  onChange,
}: SegmentProps) => {
  return (
    <SegmentGroup.Root
      size="md"
      value={value}
      defaultValue={defaultValue}
      onValueChange={(e) => onChange?.(e.value)}
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Items items={items} />
    </SegmentGroup.Root>
  );
};
