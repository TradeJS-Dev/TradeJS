'use client';

import { useState } from 'react';
import { Button, CloseButton, Drawer, Portal } from '@chakra-ui/react';
import { TestCardStatTable } from '../Stat';
import { useTestContext } from '../context';

interface TestCardStatDrawerPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TestCardStatDrawerPanel = ({
  open,
  onOpenChange,
}: TestCardStatDrawerPanelProps) => {
  const {
    testResult: { test },
  } = useTestContext();

  return (
    <Drawer.Root
      size="xl"
      open={open}
      onOpenChange={(event) => onOpenChange(event.open)}
    >
      <Portal>
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content
            display="flex"
            flexDirection="column"
            w="50vw"
            minW="640px"
            maxW="50vw"
            bg="gray.950"
          >
            <Drawer.Header>
              <Drawer.Title>{test.symbol} stat</Drawer.Title>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body overflowY="auto" flex="1" minH="0" w="full">
              <TestCardStatTable />
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};

export const TestCardStatDrawer = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Stat
      </Button>
      <TestCardStatDrawerPanel open={open} onOpenChange={setOpen} />
    </>
  );
};
