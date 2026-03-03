'use client';

import { Switch } from '@chakra-ui/react';

interface SwitcherProps {
  defaultValue: boolean;
  label: string;
  onChange?: (value: boolean) => void;
}

export const Switcher = ({ defaultValue, label, onChange }: SwitcherProps) => {
  return (
    <Switch.Root
      checked={defaultValue}
      onCheckedChange={(e) => onChange?.(e.checked)}
    >
      <Switch.HiddenInput />
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
      <Switch.Label>{label}</Switch.Label>
    </Switch.Root>
  );
};
