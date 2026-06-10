import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BulkDeleteToolbar } from '../index';

jest.mock('@chakra-ui/react', () => {
  const React = require('react');

  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );

  const Button = ({
    children,
    disabled,
    onClick,
    type,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    'aria-label'?: string;
  }) => (
    <button
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );

  const CheckboxRoot = ({
    children,
    onCheckedChange,
  }: {
    children?: React.ReactNode;
    onCheckedChange?: (details: { checked: boolean }) => void;
  }) => (
    <label>
      <input
        data-testid="select-all"
        type="checkbox"
        onChange={(event) =>
          onCheckedChange?.({ checked: event.currentTarget.checked })
        }
      />
      {children}
    </label>
  );

  return {
    Button,
    CloseButton: Button,
    Flex: passthrough,
    Portal: passthrough,
    Text: passthrough,
    Checkbox: {
      Root: CheckboxRoot,
      HiddenInput: () => null,
      Control: () => null,
    },
    Dialog: {
      Root: passthrough,
      Backdrop: passthrough,
      Positioner: passthrough,
      Content: passthrough,
      Header: passthrough,
      Title: passthrough,
      CloseTrigger: passthrough,
      Body: passthrough,
      Footer: passthrough,
      ActionTrigger: passthrough,
    },
  };
});

describe('BulkDeleteToolbar', () => {
  it('opens confirmation without confirming deletion', () => {
    const onRequestDelete = jest.fn();
    const onConfirmDelete = jest.fn();

    render(
      <BulkDeleteToolbar
        selectedCount={3}
        checkboxState={true}
        hasSelection
        isDeleting={false}
        dialogOpen={false}
        deleteTitle="Delete selected Replay cards"
        deleteDescription="Delete selected Replay cards (3)?"
        onDialogOpenChange={jest.fn()}
        onToggleAll={jest.fn()}
        onRequestDelete={onRequestDelete}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    fireEvent.click(screen.getByLabelText('Open delete confirmation'));

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onConfirmDelete).not.toHaveBeenCalled();
  });

  it('confirms deletion only from the dialog confirm button', () => {
    const onConfirmDelete = jest.fn();

    render(
      <BulkDeleteToolbar
        selectedCount={3}
        checkboxState={true}
        hasSelection
        isDeleting={false}
        dialogOpen
        deleteTitle="Delete selected Replay cards"
        deleteDescription="Delete selected Replay cards (3)?"
        onDialogOpenChange={jest.fn()}
        onToggleAll={jest.fn()}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    fireEvent.click(screen.getByLabelText('Confirm delete'));

    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
  });
});
