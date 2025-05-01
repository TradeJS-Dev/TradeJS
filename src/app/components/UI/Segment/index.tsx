'use client';

import { SegmentGroup } from '@chakra-ui/react';
import { Items } from '@types';

interface SegmentProps {
  defaultValue: string;
  items: Items;
  onChange?: (value: string | null) => void;
}

export const Segment = ({ defaultValue, items, onChange }: SegmentProps) => {
  return (
    <SegmentGroup.Root
      defaultValue={defaultValue}
      onValueChange={(e) => onChange?.(e.value)}
    >
      <SegmentGroup.Indicator />
      <SegmentGroup.Items items={items} />
    </SegmentGroup.Root>
  );
};
