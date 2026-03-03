'use client';

import { useState } from 'react';
import {
  Button,
  CloseButton,
  Dialog,
  IconButton,
  Portal,
  Text,
} from '@chakra-ui/react';
import { FiTrash2 } from 'react-icons/fi';
import { deleteBacktest } from '@actions/backtest';
import { useBacktestMutations } from '@store';
import { toaster } from '@UI';
import { useTestContext } from '../context';

export const TestCardDeleteButton = () => {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { removeBacktestTest } = useBacktestMutations();
  const { testResult } = useTestContext();

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const isDeleted = await deleteBacktest(
        testResult.test.name,
        testResult.test.strategyName,
      );

      if (!isDeleted) {
        setError('Failed to delete backtest.');
        toaster.error({
          title: 'Delete failed',
          description: 'Backtest was not deleted.',
        });
        return;
      }

      await removeBacktestTest(testResult.test.name);
      setOpen(false);
      toaster.success({
        title: 'Backtest deleted',
        description: testResult.test.name,
      });
    } catch {
      setError('Failed to delete backtest.');
      toaster.error({
        title: 'Delete failed',
        description: 'Unexpected error while deleting backtest.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) {
          setError(null);
        }
      }}
    >
      <Dialog.Trigger asChild>
        <IconButton
          size="xs"
          colorPalette="red"
          variant="outline"
          aria-label="Delete backtest"
        >
          <FiTrash2 />
        </IconButton>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Delete test</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <CloseButton position="absolute" right="3" top="3" />
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body>
              <Text fontSize="sm" color="gray.200">
                Delete backtest <b>{testResult.test.name}</b>?
              </Text>
              <Text fontSize="sm" color="gray.400" mt={2}>
                This action cannot be undone.
              </Text>
              {error ? (
                <Text fontSize="sm" color="red.400" mt={3}>
                  {error}
                </Text>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="red"
                size="sm"
                onClick={handleDelete}
                loading={isDeleting}
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};
