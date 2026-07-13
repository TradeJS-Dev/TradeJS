import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { Select } from '../Select';
import { SelectWithSearch } from '../SelectWithSearch';

const selectRootMock = jest.fn();
const comboboxRootMock = jest.fn();

jest.mock('@chakra-ui/react', () => {
  const React = require('react');

  const SelectRoot = ({
    children,
    onOpenChange,
    disabled,
  }: {
    children: React.ReactNode;
    onOpenChange?: (details: { open: boolean }) => void;
    disabled?: boolean;
  }) => {
    selectRootMock({ onOpenChange, disabled });
    return (
      <div>
        <button
          data-testid="select-open"
          onClick={() => onOpenChange?.({ open: true })}
        />
        <button
          data-testid="select-close"
          onClick={() => onOpenChange?.({ open: false })}
        />
        {children}
      </div>
    );
  };

  const ComboboxRoot = ({
    children,
    onOpenChange,
    inputValue,
  }: {
    children: React.ReactNode;
    onOpenChange?: (details: { open: boolean }) => void;
    inputValue?: string;
  }) => {
    comboboxRootMock({ onOpenChange, inputValue });
    return (
      <div>
        <button
          data-testid="combobox-open"
          onClick={() => onOpenChange?.({ open: true })}
        />
        <button
          data-testid="combobox-close"
          onClick={() => onOpenChange?.({ open: false })}
        />
        {children}
      </div>
    );
  };

  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Portal: passthrough,
    Stack: passthrough,
    Span: passthrough,
    HStack: passthrough,
    createListCollection: ({ items }: { items: unknown[] }) => ({ items }),
    useFilter: () => ({ contains: jest.fn() }),
    useListCollection: ({ initialItems }: { initialItems: unknown[] }) => ({
      collection: { items: initialItems },
      filter: jest.fn(),
      set: jest.fn(),
    }),
    Select: {
      Root: SelectRoot,
      HiddenSelect: () => null,
      Control: passthrough,
      Trigger: passthrough,
      ValueText: () => null,
      IndicatorGroup: passthrough,
      Indicator: () => null,
      Positioner: passthrough,
      Content: passthrough,
      Item: passthrough,
      ItemText: passthrough,
      ItemIndicator: () => null,
    },
    Combobox: {
      Root: ComboboxRoot,
      Control: passthrough,
      Input: () => null,
      IndicatorGroup: passthrough,
      Trigger: () => null,
      Positioner: passthrough,
      Content: passthrough,
      Empty: passthrough,
      Item: passthrough,
      ItemIndicator: () => null,
    },
  };
});

describe('select wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates open state from Select root', () => {
    const onOpenChange = jest.fn();

    const { getByTestId } = render(
      <Select
        defaultValue={['BTCUSDT']}
        items={[{ value: 'BTCUSDT', label: 'BTCUSDT' }]}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(getByTestId('select-open'));
    fireEvent.click(getByTestId('select-close'));

    expect(onOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  it('passes disabled state to Select root', () => {
    render(<Select defaultValue={['']} items={[]} disabled />);

    expect(selectRootMock).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('propagates open state from SelectWithSearch root', () => {
    const onOpenChange = jest.fn();

    const { getByTestId } = render(
      <SelectWithSearch
        defaultValue={['BTCUSDT']}
        items={[{ value: 'BTCUSDT', label: 'BTCUSDT' }]}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(getByTestId('combobox-open'));
    fireEvent.click(getByTestId('combobox-close'));

    expect(onOpenChange).toHaveBeenNthCalledWith(1, true);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  it('restores the selected ticker label after search closes', () => {
    const { getByTestId } = render(
      <SelectWithSearch
        defaultValue={['AAPLUSDT']}
        defaultInputValue="AAPL"
        items={[{ value: 'AAPLUSDT', label: 'AAPL' }]}
      />,
    );

    expect(comboboxRootMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputValue: 'AAPL' }),
    );

    fireEvent.click(getByTestId('combobox-open'));
    expect(comboboxRootMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputValue: '' }),
    );

    fireEvent.click(getByTestId('combobox-close'));
    expect(comboboxRootMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputValue: 'AAPL' }),
    );
  });
});
