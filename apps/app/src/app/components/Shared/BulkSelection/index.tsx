'use client';

import type { ReactNode } from 'react';
import {
  Button,
  Checkbox,
  CloseButton,
  Dialog,
  Flex,
  Portal,
  Text,
} from '@chakra-ui/react';
import { useBulkSelection } from './useBulkSelection';
import type { BulkCheckboxState } from './utils';

interface BulkDeleteToolbarProps {
  selectedCount: number;
  checkboxState: BulkCheckboxState;
  hasSelection: boolean;
  isDeleting: boolean;
  dialogOpen: boolean;
  deleteTitle: ReactNode;
  deleteDescription: ReactNode;
  deleteHint?: ReactNode;
  selectAllLabel?: string;
  selectedLabel?: ReactNode;
  onDialogOpenChange: (open: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onRequestDelete?: () => void;
  onConfirmDelete: () => void;
}

export const BulkDeleteToolbar = ({
  selectedCount,
  checkboxState,
  hasSelection,
  isDeleting,
  dialogOpen,
  deleteTitle,
  deleteDescription,
  deleteHint = 'This action cannot be undone.',
  selectAllLabel = 'Select filtered items',
  selectedLabel,
  onDialogOpenChange,
  onToggleAll,
  onRequestDelete,
  onConfirmDelete,
}: BulkDeleteToolbarProps) => (
  <Flex mb={4} gap={4} alignItems="center" w="full" minH="32px">
    <Checkbox.Root
      size="sm"
      colorPalette="teal"
      checked={checkboxState}
      onCheckedChange={(details) => onToggleAll(details.checked === true)}
    >
      <Checkbox.HiddenInput aria-label={selectAllLabel} />
      <Checkbox.Control bg="gray.800" borderColor="gray.500" />
    </Checkbox.Root>
    <Text color="gray.200" fontWeight="semibold">
      {selectedLabel ?? `Selected: ${selectedCount}`}
    </Text>

    <Button
      type="button"
      size="sm"
      colorPalette="red"
      variant="outline"
      aria-label="Open delete confirmation"
      disabled={!hasSelection || isDeleting}
      onClick={() => {
        if (!hasSelection || isDeleting) {
          return;
        }

        if (onRequestDelete) {
          onRequestDelete();
          return;
        }

        onDialogOpenChange(true);
      }}
    >
      Delete
    </Button>

    <Dialog.Root
      open={dialogOpen}
      onOpenChange={(event) => onDialogOpenChange(event.open)}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{deleteTitle}</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <CloseButton position="absolute" right="3" top="3" />
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="gray.200">
                {deleteDescription}
              </Text>
              {deleteHint ? (
                <Text fontSize="sm" color="gray.400" mt={2}>
                  {deleteHint}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </Dialog.ActionTrigger>
              <Button
                type="button"
                colorPalette="red"
                size="sm"
                aria-label="Confirm delete"
                onClick={onConfirmDelete}
                loading={isDeleting}
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  </Flex>
);

export { useBulkSelection };
export type { BulkCheckboxState };
