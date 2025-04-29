"use client"

import { SegmentGroup } from "@chakra-ui/react"

interface Item {
  label: string;
  value: string;
}

interface SegmentProps {
  defaultValue: string;
  items: Item[];
  onChange?: (value: string | null) => void;
}

export const Segment = ({defaultValue, items, onChange}: SegmentProps) => {
  return (
    <SegmentGroup.Root defaultValue={defaultValue} onValueChange={(e) => onChange?.(e.value)}>
      <SegmentGroup.Indicator />
      <SegmentGroup.Items items={items} />
    </SegmentGroup.Root>
  )
}